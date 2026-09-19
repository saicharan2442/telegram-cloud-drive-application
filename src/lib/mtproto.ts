/**
 * Telegram MTProto client — logs in with YOUR USER ACCOUNT (no bot anywhere).
 *
 * Transport: MTProto over WebSocket straight to Telegram's DCs
 * (wss://{pluto,venus,aurora,vesta,flora}.web.telegram.org/apiws) — exactly the
 * transport Telegram Web uses. There is no proxy, no backend and no database.
 *
 * Because this is the real client API, it can do what a bot cannot:
 *   • browse the FULL history of a private channel (messages.getHistory, paged)
 *   • upload files up to 2 GB  • download files of any size (chunked)
 *   • delete messages  • list your channels (messages.getDialogs)
 */
import MTProto from "@mtproto/core/envs/browser";

export interface TgFailure {
  code: number;
  message: string;
  retryAfter?: number;
}

export class TgError extends Error {
  code: number;
  retryAfter?: number;
  constructor(message: string, code = 0, retryAfter?: number) {
    super(message);
    this.name = "TgError";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

const PREFIX = "tcd.mt.";

/**
 * Session storage for the MTProto auth keys.
 *   persist=false → RAM only, everything gone when the window closes
 *   persist=true  → localStorage (in the packaged Tauri build this is swapped
 *                   for the Windows Credential Manager — see DOCS.md).
 * It only ever holds auth keys / DC ids. No file metadata is stored here.
 */
export function makeStorage(persist: boolean) {
  const mem = new Map<string, string>();
  return {
    async get(key: string) {
      return persist ? localStorage.getItem(PREFIX + key) : (mem.get(key) ?? null);
    },
    async set(key: string, value: string) {
      if (persist) localStorage.setItem(PREFIX + key, value);
      else mem.set(key, value);
    },
  };
}

export function wipePersistedSession() {
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  }
}

export function hasPersistedSession() {
  return Object.keys(localStorage).some((k) => k.startsWith(PREFIX));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TgClient {
  readonly mtproto: MTProto;
  readonly apiId: number;
  readonly apiHash: string;

  constructor(apiId: number, apiHash: string, persist: boolean) {
    this.apiId = apiId;
    this.apiHash = apiHash;
    this.mtproto = new MTProto({
      api_id: apiId,
      api_hash: apiHash,
      storageOptions: { instance: makeStorage(persist) },
    });
  }

  /**
   * Single entry point for every API call. Handles the three things Telegram
   * genuinely throws at clients: DC migration, flood-wait and transport errors.
   */
  async call<T = any>(
    method: string,
    params: Record<string, unknown> = {},
    options: { dcId?: number; syncAuth?: boolean } = {},
    depth = 0,
  ): Promise<T> {
    try {
      return (await this.mtproto.call(method, params, options)) as T;
    } catch (raw: any) {
      const code: number = raw?.error_code ?? 0;
      const message: string = raw?.error_message ?? raw?.message ?? "";

      // 420 FLOOD_WAIT_X — respect it, never hammer Telegram.
      if (code === 420 && message.startsWith("FLOOD_WAIT_")) {
        const seconds = Number(message.split("FLOOD_WAIT_")[1]) || 0;
        if (seconds <= 30 && depth < 2) {
          await sleep((seconds + 1) * 1000);
          return this.call<T>(method, params, options, depth + 1);
        }
        throw new TgError(
          `Telegram rate limit: please wait ${seconds}s before retrying.`,
          420,
          seconds,
        );
      }

      // 303 *_MIGRATE_X — the request belongs to another data centre.
      if (code === 303 && message.includes("_MIGRATE_") && depth < 3) {
        const [type, dcStr] = message.split("_MIGRATE_");
        const dcId = Number(dcStr);
        if (type === "PHONE" || type === "NETWORK" || type === "USER") {
          await this.mtproto.setDefaultDc(dcId);
          return this.call<T>(method, params, options, depth + 1);
        }
        return this.call<T>(method, params, { ...options, dcId }, depth + 1);
      }

      if (raw?.type === "socket" || (!code && !message)) {
        throw new TgError(
          "Connection to Telegram lost. Check your internet connection and retry.",
          -1,
        );
      }
      throw new TgError(humanise(message, method), code);
    }
  }

  /* ------------------------------------------------------------------ auth */

  async getMe() {
    const user = await this.call<any>("users.getFullUser", {
      id: { _: "inputUserSelf" },
    });
    const u = user?.users?.[0] ?? {};
    return {
      userId: String(u.id ?? ""),
      firstName: u.first_name,
      username: u.username,
      phone: u.phone,
    };
  }

  sendCode(phone: string) {
    return this.call<any>("auth.sendCode", {
      phone_number: phone,
      api_id: this.apiId,
      api_hash: this.apiHash,
      settings: { _: "codeSettings" },
    });
  }

  resendCode(phone: string, phoneCodeHash: string) {
    return this.call<any>("auth.resendCode", {
      phone_number: phone,
      phone_code_hash: phoneCodeHash,
    });
  }

  exportLoginToken() {
    return this.call<any>("auth.exportLoginToken", {
      api_id: this.apiId,
      api_hash: this.apiHash,
      except_ids: [],
    });
  }

  async importLoginToken(token: Uint8Array, dcId: number) {
    await this.mtproto.setDefaultDc(dcId);
    return this.call<any>("auth.importLoginToken", { token });
  }

  signIn(phone: string, phoneCodeHash: string, code: string) {
    return this.call<any>("auth.signIn", {
      phone_number: phone,
      phone_code_hash: phoneCodeHash,
      phone_code: code,
    });
  }

  /** Two-step verification, using Telegram's SRP protocol. */
  async checkPassword(password: string) {
    const info = await this.call<any>("account.getPassword");
    const { srp_id, current_algo, srp_B } = info;
    if (!current_algo || !srp_B)
      throw new TgError("Unsupported two-step verification algorithm.", 0);
    const { g, p, salt1, salt2 } = current_algo;
    const { A, M1 } = await this.mtproto.crypto.getSRPParams({
      g,
      p,
      salt1,
      salt2,
      gB: srp_B,
      password,
    });
    return this.call<any>("auth.checkPassword", {
      password: { _: "inputCheckPasswordSRP", srp_id, A, M1 },
    });
  }

  logOut() {
    return this.call("auth.logOut").catch(() => undefined);
  }
}

/** Turn raw Telegram error constants into sentences a human can act on. */
function humanise(message: string, method: string): string {
  const map: Record<string, string> = {
    API_ID_INVALID: "That api_id / api_hash pair is not valid. Check my.telegram.org.",
    API_ID_PUBLISHED_FLOOD:
      "This api_id is flood-limited by Telegram. Create your own at my.telegram.org.",
    PHONE_NUMBER_INVALID: "That phone number is not valid. Use the +country format.",
    PHONE_NUMBER_BANNED: "This phone number is banned from Telegram.",
    PHONE_CODE_INVALID: "The login code is incorrect.",
    PHONE_CODE_EXPIRED: "The login code expired. Request a new one.",
    PHONE_CODE_EMPTY: "Enter the login code you received.",
    SESSION_PASSWORD_NEEDED: "Two-step verification password required.",
    PASSWORD_HASH_INVALID: "That two-step verification password is incorrect.",
    AUTH_KEY_UNREGISTERED: "Your session has expired. Please sign in again.",
    SESSION_REVOKED: "This session was revoked from another device. Sign in again.",
    SESSION_EXPIRED: "Your session expired. Please sign in again.",
    CHANNEL_INVALID: "That channel is not accessible with this account.",
    CHANNEL_PRIVATE: "You are not a member of this private channel any more.",
    CHAT_ADMIN_REQUIRED: "You need admin rights in the channel for this action.",
    MESSAGE_DELETE_FORBIDDEN: "Telegram does not allow you to delete this message.",
    MESSAGE_ID_INVALID: "That message no longer exists in the channel.",
    FILE_REFERENCE_EXPIRED: "The file reference expired — refresh the listing and retry.",
    FILE_PARTS_INVALID: "Telegram rejected the uploaded parts. Retry the upload.",
    FILE_PART_SIZE_INVALID: "Invalid upload chunk size.",
    PHOTO_EXT_INVALID: "Telegram rejected this file type.",
    TIMEOUT: "Telegram timed out. Please retry.",
  };
  if (map[message]) return map[message];
  if (!message) return `Telegram rejected ${method}.`;
  return `${message} (${method})`;
}
