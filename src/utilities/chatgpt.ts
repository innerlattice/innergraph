// ChatGPT plan sign-in: OpenAI's device-code flow (the one Codex uses for headless sign-in).
// The person opens OpenAI's page, enters the code we show, and this app receives its own
// tokens; models are then called directly on their plan. No Codex app, CLI or MCP involved.
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export const ISSUER = "https://auth.openai.com";
/** Codex's public OAuth client id (a public identifier, not a secret). */
export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const DEVICE_PAGE = `${ISSUER}/codex/device`;
export const PLAN_BACKEND = "https://chatgpt.com/backend-api/codex";
const REDIRECT = `${ISSUER}/deviceauth/callback`;

export type Fetch = typeof fetch;

export interface ChatGptTokens {
  access: string;
  refresh: string;
  accountId: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  plan?: string;
  email?: string;
}

export interface DeviceCode {
  deviceAuthId: string;
  userCode: string;
  /** Seconds between polls. */
  interval: number;
  url: string;
}

export class ChatGptAuthError extends Error {}

/** A JWT's claims, unverified: only used to read our own tokens' expiry, account and plan. */
export function claims(jwt: string | undefined): Record<string, unknown> {
  const payload = jwt?.split(".")[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

interface TokenResponse {
  id_token?: string;
  access_token: string;
  refresh_token?: string;
}

type AuthClaims = { chatgpt_account_id?: string; chatgpt_plan_type?: string };

function authOf(id: Record<string, unknown>, access: Record<string, unknown>): AuthClaims {
  return (id["https://api.openai.com/auth"] ?? access["https://api.openai.com/auth"] ?? {}) as AuthClaims;
}

function expiryOf(access: Record<string, unknown>, now: number): number {
  const exp = Number(access.exp);
  return exp > 0 ? exp * 1000 : now + 60 * 60_000;
}

/** Tokens from a token response; a refresh may leave out what the first sign-in gave. */
export function tokensFrom(response: TokenResponse, previous?: ChatGptTokens, now = Date.now()): ChatGptTokens {
  const id = claims(response.id_token);
  const access = claims(response.access_token);
  const auth = authOf(id, access);
  const fresh = { refresh: response.refresh_token, accountId: auth.chatgpt_account_id, plan: auth.chatgpt_plan_type, email: id.email as string | undefined };
  const kept = Object.fromEntries(Object.entries(fresh).filter(([, v]) => v !== undefined));
  return { refresh: "", accountId: "", ...previous, ...kept, access: response.access_token, expiresAt: expiryOf(access, now) };
}

function postJson(http: Fetch, url: string, body: unknown): Promise<Response> {
  return http(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function failure(res: Response, what: string): Promise<ChatGptAuthError> {
  const text = await res.text().catch(() => "");
  return new ChatGptAuthError(`${what} failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`);
}

/** Step 1: a code for the person to enter on OpenAI's device page. */
export async function requestDeviceCode(http: Fetch = fetch): Promise<DeviceCode> {
  const res = await postJson(http, `${ISSUER}/api/accounts/deviceauth/usercode`, { client_id: CLIENT_ID });
  if (!res.ok) throw await failure(res, "Starting sign-in");
  const body = (await res.json()) as { device_auth_id: string; user_code?: string; usercode?: string; interval?: string | number };
  return { deviceAuthId: body.device_auth_id, userCode: body.user_code ?? body.usercode ?? "", interval: Number(body.interval) || 5, url: DEVICE_PAGE };
}

/** Step 2, repeated: undefined while the person hasn't finished; tokens once they have. */
export async function pollDeviceCode(code: DeviceCode, http: Fetch = fetch): Promise<ChatGptTokens | undefined> {
  const res = await postJson(http, `${ISSUER}/api/accounts/deviceauth/token`, { device_auth_id: code.deviceAuthId, user_code: code.userCode });
  if (res.status === 403 || res.status === 404) return undefined;
  if (!res.ok) throw await failure(res, "Signing in");
  const grant = (await res.json()) as { authorization_code: string; code_verifier: string };
  const form = new URLSearchParams({ grant_type: "authorization_code", code: grant.authorization_code, redirect_uri: REDIRECT, client_id: CLIENT_ID, code_verifier: grant.code_verifier });
  const token = await http(`${ISSUER}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  if (!token.ok) throw await failure(token, "Finishing sign-in");
  return tokensFrom((await token.json()) as TokenResponse);
}

export async function refreshTokens(tokens: ChatGptTokens, http: Fetch = fetch): Promise<ChatGptTokens> {
  const res = await postJson(http, `${ISSUER}/oauth/token`, { client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: tokens.refresh, scope: "openid profile email" });
  if (!res.ok) throw await failure(res, "Refreshing the ChatGPT sign-in");
  return tokensFrom((await res.json()) as TokenResponse, tokens);
}

/** The plan's backend takes part of the public Responses API: nothing stored, no token caps. */
export function prepareBody(body: Record<string, unknown>): Record<string, unknown> {
  const { max_output_tokens: _max, temperature: _t, top_p: _p, ...rest } = body;
  return { ...rest, store: false, stream: true };
}

/** Signs each request with fresh tokens and trims the body to what the backend accepts. */
export function planFetch(tokens: () => Promise<ChatGptTokens>, http: Fetch = fetch): Fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const t = await tokens();
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${t.access}`);
    headers.set("chatgpt-account-id", t.accountId);
    headers.set("openai-beta", "responses=experimental");
    headers.set("originator", "codex_cli_rs");
    const body = typeof init?.body === "string" ? JSON.stringify(prepareBody(JSON.parse(init.body))) : init?.body;
    return http(input, { ...init, headers, body });
  }) as Fetch;
}

export function chatgptModel(model: string, tokens: () => Promise<ChatGptTokens>, http: Fetch = fetch): LanguageModel {
  return createOpenAI({ apiKey: "chatgpt-plan", baseURL: PLAN_BACKEND, fetch: planFetch(tokens, http) }).responses(model);
}

/** Per-turn options: instructions go as `instructions`, reasoning stays client-side (encrypted). */
export function chatgptOptions(instructions: string, effort: string) {
  return { openai: { instructions, store: false, include: ["reasoning.encrypted_content" as const], reasoningEffort: effort, reasoningSummary: "auto", systemMessageMode: "remove" as const } };
}

export { PLAN_MODELS, type PlanModel } from "./planModels.js";
