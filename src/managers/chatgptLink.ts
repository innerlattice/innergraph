// The link to the person's ChatGPT plan: the device-code sign-in in progress, the tokens it
// produced (kept in the encrypted Vault), and refreshing them before they expire.
import type { VaultAccess } from "../access/vaultAccess.js";
import { type ChatGptTokens, type DeviceCode, type Fetch, pollDeviceCode, refreshTokens, requestDeviceCode } from "../utilities/chatgpt.js";
import { ChatModelError, type PlanTokens } from "../utilities/chatModel.js";

type LinkState = "disconnected" | "pending" | "connected";

export interface LinkStatus {
  state: LinkState;
  /** While pending: the code to enter, and where. */
  userCode?: string;
  url?: string;
  plan?: string;
  email?: string;
  /** Why the last attempt failed, if it did. */
  error?: string;
}

const KEY = "chatgpt";
/** OpenAI's device codes last fifteen minutes. */
const CODE_LIFETIME = 15 * 60_000;
/** Refresh this long before the access token expires. */
const MARGIN = 5 * 60_000;

/** Where the tokens live: the Vault's encrypted settings. */
export type SettingsStore = Pick<VaultAccess, "readSetting" | "writeSetting">;

export interface LinkDeps {
  vault: SettingsStore;
  http?: Fetch;
  now?: () => number;
  /** Runs `fn` after `ms`; tests step it by hand. */
  later?: (fn: () => void, ms: number) => void;
}

export class ChatGptLink {
  private pending?: { code: DeviceCode; expires: number };
  private error?: string;
  private readonly now: () => number;
  private readonly later: (fn: () => void, ms: number) => void;

  constructor(private readonly deps: LinkDeps) {
    this.now = deps.now ?? Date.now;
    this.later = deps.later ?? ((fn, ms) => setTimeout(fn, ms).unref());
  }

  private stored(): ChatGptTokens | undefined {
    return this.deps.vault.readSetting<ChatGptTokens | null>(KEY) ?? undefined;
  }

  private save(tokens: ChatGptTokens | null): void {
    this.deps.vault.writeSetting(KEY, tokens);
  }

  status(): LinkStatus {
    const tokens = this.stored();
    if (this.pending) return { state: "pending", userCode: this.pending.code.userCode, url: this.pending.code.url, error: this.error };
    if (tokens) return { state: "connected", plan: tokens.plan, email: tokens.email };
    return { state: "disconnected", error: this.error };
  }

  /** Starts a sign-in: the person enters the returned code on OpenAI's page; we poll until done. */
  async connect(): Promise<LinkStatus> {
    this.error = undefined;
    const code = await requestDeviceCode(this.deps.http);
    this.pending = { code, expires: this.now() + CODE_LIFETIME };
    this.schedule();
    return this.status();
  }

  private schedule(): void {
    const pending = this.pending;
    if (pending) this.later(() => void this.poll(pending), pending.code.interval * 1000);
  }

  /** One poll; stops when the attempt was replaced, finished, failed or expired. */
  async poll(attempt: { code: DeviceCode; expires: number }): Promise<void> {
    if (this.pending !== attempt) return;
    if (this.now() > attempt.expires) return this.fail("The code expired. Try connecting again.");
    try {
      const tokens = await pollDeviceCode(attempt.code, this.deps.http);
      if (!tokens) return this.schedule();
      this.save(tokens);
      this.pending = undefined;
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private fail(message: string): void {
    this.pending = undefined;
    this.error = message;
  }

  disconnect(): LinkStatus {
    this.pending = undefined;
    this.error = undefined;
    this.save(null);
    return this.status();
  }

  /** Where a turn on the plan gets its tokens; undefined until the person signs in. */
  planTokens(): PlanTokens {
    return this.stored() ? () => this.tokens() : undefined;
  }

  /** Current tokens, refreshed first when they are about to expire. */
  async tokens(): Promise<ChatGptTokens> {
    const tokens = this.stored();
    if (!tokens) throw new ChatModelError("Connect your ChatGPT plan in Settings, or choose another provider.");
    if (tokens.expiresAt - MARGIN > this.now()) return tokens;
    const fresh = await refreshTokens(tokens, this.deps.http);
    this.save(fresh);
    return fresh;
  }
}
