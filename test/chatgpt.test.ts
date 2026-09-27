import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/clients/http.js";
import { ChatGptLink, type SettingsStore } from "../src/managers/chatgptLink.js";
import { ChatGptAuthError, PLAN_MODELS, chatgptModel, chatgptOptions, claims, planFetch, pollDeviceCode, prepareBody, refreshTokens, requestDeviceCode, tokensFrom } from "../src/utilities/chatgpt.js";
import { ChatModelError, chatModel } from "../src/utilities/chatModel.js";
import { type TestVault, makeVault } from "./helpers.js";

const jwt = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
const NOW = Date.UTC(2026, 8, 26);
const AUTH = "https://api.openai.com/auth";
const tokenBody = (exp = NOW / 1000 + 3600) => ({
  id_token: jwt({ email: "me@example.com", [AUTH]: { chatgpt_account_id: "acct", chatgpt_plan_type: "pro" } }),
  access_token: jwt({ exp }),
  refresh_token: "r1",
});

/** A stand-in for OpenAI's auth server: scripted responses per path, and every call recorded. */
function fakeOpenAI(routes: Record<string, (() => Response)[]>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const queue = routes[new URL(url).pathname] ?? [];
    return (queue.length > 1 ? queue.shift() : queue[0])?.() ?? new Response("nope", { status: 500 });
  }) as typeof fetch;
  return { http, calls };
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });

let t: TestVault;
let store: SettingsStore;
beforeEach(() => {
  t = makeVault();
  const settings = new Map<string, unknown>();
  store = { readSetting: <T,>(key: string) => settings.get(key) as T | undefined, writeSetting: (key: string, value: unknown) => void settings.set(key, value) };
});
afterEach(() => t.cleanup());

describe("ChatGPT sign-in", () => {
  it("reads token claims and keeps what a refresh leaves out", () => {
    expect(claims(undefined)).toEqual({});
    expect(claims("a.!!!.c")).toEqual({});
    const first = tokensFrom(tokenBody(), undefined, NOW);
    expect(first).toMatchObject({ refresh: "r1", accountId: "acct", plan: "pro", email: "me@example.com", expiresAt: NOW + 3_600_000 });
    const refreshed = tokensFrom({ access_token: "opaque" }, first, NOW);
    expect(refreshed).toMatchObject({ refresh: "r1", accountId: "acct", plan: "pro", email: "me@example.com", expiresAt: NOW + 3_600_000 });
    expect(tokensFrom({ access_token: jwt({ [AUTH]: { chatgpt_account_id: "b" } }) }, undefined, NOW).accountId).toBe("b");
  });

  it("gets a device code, waits for the person, then exchanges the grant", async () => {
    const { http, calls } = fakeOpenAI({
      "/api/accounts/deviceauth/usercode": [json({ device_auth_id: "d1", user_code: "ABCD-EFGH", interval: "3" })],
      "/api/accounts/deviceauth/token": [json({}, 403), json({ authorization_code: "code", code_verifier: "v" })],
      "/oauth/token": [json(tokenBody())],
    });
    const code = await requestDeviceCode(http);
    expect(code).toEqual({ deviceAuthId: "d1", userCode: "ABCD-EFGH", interval: 3, url: "https://auth.openai.com/codex/device" });
    expect(await pollDeviceCode(code, http)).toBeUndefined();
    expect((await pollDeviceCode(code, http))?.accountId).toBe("acct");
    const exchange = String(calls.at(-1)?.init?.body);
    expect(exchange).toContain("grant_type=authorization_code");
    expect(exchange).toContain("code_verifier=v");
  });

  it("reports failures at each step", async () => {
    const down = fakeOpenAI({ "/api/accounts/deviceauth/usercode": [() => new Response("", { status: 429 })] });
    await expect(requestDeviceCode(down.http)).rejects.toThrow("Starting sign-in failed (429)");
    const code = { deviceAuthId: "d", userCode: "u", interval: 1, url: "" };
    await expect(pollDeviceCode(code, fakeOpenAI({ "/api/accounts/deviceauth/token": [json({ error: "x" }, 500)] }).http)).rejects.toThrow(ChatGptAuthError);
    const badExchange = fakeOpenAI({ "/api/accounts/deviceauth/token": [json({ authorization_code: "c", code_verifier: "v" })], "/oauth/token": [json({}, 400)] });
    await expect(pollDeviceCode(code, badExchange.http)).rejects.toThrow("Finishing sign-in");
    await expect(refreshTokens(tokensFrom(tokenBody()), fakeOpenAI({ "/oauth/token": [json({}, 401)] }).http)).rejects.toThrow("Refreshing");
    const usercode = fakeOpenAI({ "/api/accounts/deviceauth/usercode": [json({ device_auth_id: "d", usercode: "X" })] });
    expect(await requestDeviceCode(usercode.http)).toMatchObject({ userCode: "X", interval: 5 });
  });

  it("signs plan requests and trims what the backend refuses", async () => {
    expect(prepareBody({ model: "m", max_output_tokens: 5, temperature: 1, top_p: 1, store: true })).toEqual({ model: "m", store: false, stream: true });
    const { http, calls } = fakeOpenAI({ "/x": [json({})] });
    const signed = planFetch(async () => tokensFrom(tokenBody()), http);
    await signed("https://chatgpt.com/x", { method: "POST", body: JSON.stringify({ temperature: 0 }), headers: { "x-keep": "1" } });
    await signed("https://chatgpt.com/x");
    const headers = new Headers(calls[0].init?.headers);
    expect([headers.get("chatgpt-account-id"), headers.get("x-keep"), headers.get("authorization")?.startsWith("Bearer ")]).toEqual(["acct", "1", true]);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ store: false, stream: true });
    expect(chatgptModel("gpt-6-sol", async () => tokensFrom(tokenBody()), http)).toBeTruthy();
    expect(chatgptOptions("be kind", "high").openai).toMatchObject({ instructions: "be kind", reasoningEffort: "high", store: false });
    expect(PLAN_MODELS[0].id).toBe("gpt-6-sol");
  });
});

describe("the ChatGPT link", () => {
  const setup = (routes: Record<string, (() => Response)[]>, clock = { now: NOW }) => {
    const queued: (() => void)[] = [];
    const fake = fakeOpenAI(routes);
    const link = new ChatGptLink({ vault: store, http: fake.http, now: () => clock.now, later: (fn) => queued.push(fn) });
    const step = async () => {
      queued.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    };
    return { link, step, queued, clock, calls: fake.calls };
  };

  it("connects, stays connected across restarts, refreshes, and disconnects", async () => {
    const { link, step, clock, calls } = setup({
      "/api/accounts/deviceauth/usercode": [json({ device_auth_id: "d1", user_code: "ABCD", interval: 1 })],
      "/api/accounts/deviceauth/token": [json({}, 404), json({ authorization_code: "c", code_verifier: "v" })],
      "/oauth/token": [json(tokenBody()), json({ ...tokenBody(NOW / 1000 + 7200), refresh_token: "r2" })],
    });
    expect(link.status()).toEqual({ state: "disconnected", error: undefined });
    await expect(link.tokens()).rejects.toThrow(ChatModelError);
    expect(await link.connect()).toMatchObject({ state: "pending", userCode: "ABCD" });
    await step();
    expect(link.status().state).toBe("pending");
    await step();
    expect(link.status()).toMatchObject({ state: "connected", plan: "pro", email: "me@example.com" });
    expect(new ChatGptLink({ vault: store }).status().state).toBe("connected");
    expect((await link.tokens()).refresh).toBe("r1");
    clock.now = NOW + 3_590_000;
    expect((await link.tokens()).refresh).toBe("r2");
    expect(calls.filter((c) => c.url.endsWith("/oauth/token"))).toHaveLength(2);
    expect(link.disconnect().state).toBe("disconnected");
  });

  it("gives up when the code expires, the server fails, or a new attempt replaces it", async () => {
    const { link, step, clock, queued } = setup({
      "/api/accounts/deviceauth/usercode": [json({ device_auth_id: "d1", user_code: "A", interval: 1 })],
      "/api/accounts/deviceauth/token": [json({}, 404)],
    });
    await link.connect();
    clock.now += 16 * 60_000;
    await step();
    expect(link.status()).toMatchObject({ state: "disconnected", error: expect.stringContaining("expired") });
    clock.now = NOW;
    await link.connect();
    await link.connect();
    await step();
    expect(queued).toHaveLength(1);

    const failing = setup({ "/api/accounts/deviceauth/usercode": [json({ device_auth_id: "d", user_code: "A", interval: 1 })], "/api/accounts/deviceauth/token": [json({}, 500)] });
    await failing.link.connect();
    await failing.step();
    expect(failing.link.status().error).toContain("Signing in failed (500)");
  });

  it("is required before a turn on the plan, and reachable over HTTP", async () => {
    t.vault.chat.updateSettings({ provider: "chatgpt" });
    expect(t.vault.chat.publicSettings()).toMatchObject({ provider: "chatgpt", model: "gpt-6-sol", effort: "medium", hosted: true });
    const choose = (effort?: string) => chatModel({ ...t.vault.chat.settings(), effort }, "i", t.vault.chat.chatgpt.planTokens());
    expect(() => choose("medium")).toThrow(ChatModelError);
    (t.vault.chat.chatgpt as unknown as { save(tokens: unknown): void }).save(tokensFrom(tokenBody()));
    expect(choose("high").providerOptions?.openai.reasoningEffort).toBe("high");
    expect(choose(undefined).providerOptions?.openai.reasoningEffort).toBe("medium");
    const app = createApp(t.vault);
    expect((await (await app.request("/api/chat/chatgpt")).json()).state).toBe("connected");
    expect((await (await app.request("/api/chat/chatgpt", { method: "DELETE" })).json()).state).toBe("disconnected");
    const res = await app.request("/api/chat", { method: "POST", body: JSON.stringify({ id: "c", message: { id: "u", role: "user", parts: [{ type: "text", text: "hi" }] } }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(400);
  });
});
