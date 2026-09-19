# Telegram Cloud Drive

A lightweight personal cloud drive that uses **one private Telegram channel** as its storage,
signed in with **your own Telegram account**. No bots. No database. No backend.

---

## 1. Integration: Telegram Client API (MTProto) — user login

The previous bot-based build was replaced completely. Nothing in this app talks to the
Bot API any more; there is no bot token field anywhere.

| | Bot API (removed) | **MTProto user login (this build)** |
|---|---|---|
| Browse full private-channel history | ❌ impossible | ✅ `messages.getHistory`, paged |
| Upload | 50 MB | ✅ 2 GB (512 KB × 4000 parts) |
| Download | 20 MB | ✅ any size, 512 KB chunks |
| Delete | admin bot only | ✅ `channels.deleteMessages` |
| List your channels | ❌ | ✅ `messages.getDialogs` |
| Needs a bot added to the channel | yes | **no** |

**Transport.** MTProto is spoken over a WebSocket to Telegram's own web endpoints
(`wss://{pluto,venus,aurora,vesta,flora}.web.telegram.org/apiws`) — the exact transport
Telegram Web uses, via the `@mtproto/core` browser environment. That means the app connects
**directly to Telegram** with no proxy, no relay and no server of ours in the path.

**Authorisation** follows Telegram's documented flow, nothing reverse-engineered:

```
auth.sendCode → auth.signIn
             ↘ SESSION_PASSWORD_NEEDED → account.getPassword → SRP → auth.checkPassword
users.getFullUser          (resume an existing session)
auth.logOut                (disconnect)
```

Two-step verification uses Telegram's **SRP** exchange, so the password itself is never sent.

---

## 2. Architecture

```
src/
  lib/
    mtproto.ts    MTProto client: storage adapter, one call() with DC migration,
                  FLOOD_WAIT handling and human-readable error mapping; login,
                  SRP 2FA, logout
    tgdrive.ts    channel + file operations: getDialogs / resolveUsername,
                  paged getHistory, message→DriveFile mapping, chunked upload
                  (saveBigFilePart → sendMedia), chunked download, thumbnails,
                  file_reference refresh, deleteMessages
    categories.ts extension → category, computed at runtime
    format.ts     byte/date helpers        types.ts  shared types
  store/drive.tsx the only state container (React context): connection,
                  in-memory file list, paging cursor, transfer queues, toasts
  components/     LoginWizard, Sidebar, Dashboard, FileBrowser, DetailsPanel,
                  PreviewModal, TransfersPanel, SettingsPage
src-tauri/        Tauri 2 shell for the Windows build
```

### No-database guarantees

* No SQLite / IndexedDB / Firebase / Supabase / Realm / Redis dependency exists.
* File metadata lives in one React state array and disappears on logout or app close.
* Categories and counts are `useMemo`-derived on every render — never stored.
* `localStorage` holds exactly two things: UI preferences, and (only if you tick
  "stay signed in") the MTProto **authorisation key** + the chosen channel id. That is a
  credential store, not a file index. Untick the box and everything stays in RAM.
* No search index: search is an in-memory, case-insensitive filter.
* Previews and thumbnails are temporary in-memory blobs, released by
  *Settings → Clear temporary preview data* and on logout.

---

## 3. Setup

1. Go to **my.telegram.org → API development tools**, create an app, copy `api_id` and
   `api_hash`. (Telegram requires every client to have its own — none is hardcoded here.)
2. Launch the app → enter `api_id` / `api_hash`.
3. Enter your phone number → type the login code Telegram sends → enter your two-step
   password if you have one.
4. Pick the private channel to use as storage from the list of your channels (or type a
   public `@username`). The channel must already exist — the app never creates one.

Deletion of other members' posts requires admin rights in the channel; your own messages can
always be deleted. The channel picker states which rights you have.

> **Security reality check, shown in-app too:** a private channel is private, but it is
> **not end-to-end encrypted**. Telegram's servers can read the files. Treat it as
> server-side cloud storage.

---

## 4. Feature status

| Feature | Status |
|---|---|
| User login: phone + code + 2FA (SRP), session resume, logout | ✅ real MTProto |
| Channel picker from your dialogs, username resolution, channel verification | ✅ |
| Full history browsing, 60 messages per page, "Load older" / "Scan whole channel" | ✅ `messages.getHistory` |
| Upload: picker, drag & drop, queue, chunked 512 KB parts, live progress, cancel, retry | ✅ up to 2 GB |
| Download: chunked from the file's own DC, progress, cancel, OS save dialog | ✅ any size |
| Delete with confirmation; list updated only after Telegram confirms | ✅ |
| Dynamic extension categories (8), counts, grid/list, sorting, multi-select, context menu | ✅ |
| Lazy Telegram thumbnails (a few KB each), incremental tile rendering | ✅ |
| Preview: image (zoom, ←/→), video, audio, PDF, text | ✅ with an explicit "fetch N MB?" prompt above 25 MB |
| Search by name / extension / category, clearly labelled as partial vs. complete | ✅ |
| Light / dark / system theme, settings, privacy page | ✅ |
| Keyboard: Ctrl+F, Ctrl+U, F5, Delete, Esc, ←/→ | ✅ |
| **Streaming** video/audio without downloading first | ❌ Telegram media has no HTTP URL; the app says so instead of pretending |
| CDN-redirected files (`upload.fileCdnRedirect`) | ❌ not implemented — reported as a clear error |
| Folders | ❌ Telegram has no native folders; extension categories are used instead |

Rate limits are respected: `FLOOD_WAIT_x` is honoured (short waits retried once, longer ones
surfaced with the exact number of seconds), full-channel scanning pauses between pages, and
there is no polling loop anywhere — refresh is manual.

---

## 5. Windows build (Tauri 2)

```bash
# prerequisites: Rust (msvc), MS C++ Build Tools, WebView2 (bundled with Win 11)
npm install
npm install -D @tauri-apps/cli

npm run dev        # web dev server
npx tauri dev      # desktop dev build
npx tauri build    # production .exe + NSIS / MSI installer
```

Artifacts: `src-tauri/target/release/bundle/{nsis,msi}/`.
**Install:** run `Telegram Cloud Drive_1.0.0_x64-setup.exe`.
**Uninstall:** Settings → Apps → *Telegram Cloud Drive* → Uninstall.

The CSP in `src-tauri/tauri.conf.json` allows exactly one outbound destination:
`wss://*.web.telegram.org`.

> Truthfulness note: the Windows installer was **not** built in this environment (no
> Rust/MSVC toolchain here). The configuration and commands are provided; no claim is made
> that a binary exists.

**Optional hardening for the packaged app:** move the MTProto auth key from `localStorage`
into the Windows Credential Manager by adding the `keyring` crate and two Tauri commands
(`session_get` / `session_set`), then pass them as the storage adapter in
`src/lib/mtproto.ts` (`makeStorage`). The rest of the code is unaffected.

---

## 6. Error handling

Covered with clear messages and retry actions: offline state, WebSocket drop,
`API_ID_INVALID`, `PHONE_NUMBER_INVALID`, `PHONE_CODE_INVALID` / `EXPIRED`,
`SESSION_PASSWORD_NEEDED`, `PASSWORD_HASH_INVALID`, `AUTH_KEY_UNREGISTERED` /
`SESSION_REVOKED` (session expired → sign in again), `CHANNEL_PRIVATE` / `CHANNEL_INVALID`,
`CHAT_ADMIN_REQUIRED`, `MESSAGE_DELETE_FORBIDDEN`, `FILE_REFERENCE_EXPIRED` (message
re-fetched automatically, download resumed), `*_MIGRATE_x` (transparent DC switch),
`FLOOD_WAIT_x`, cancelled uploads/downloads and empty or oversized files.
