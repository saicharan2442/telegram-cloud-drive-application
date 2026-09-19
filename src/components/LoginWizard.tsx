import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Cloud,
  Loader2,
  AlertTriangle,
  ArrowRight,
  Eye,
  EyeOff,
  Info,
  Phone,
  KeyRound,
  Lock,
  Hash,
  Search,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import { TgClient, hasPersistedSession, wipePersistedSession } from "../lib/mtproto";
import { listChannels, resolveChannel } from "../lib/tgdrive";
import { loadSavedConnection, useDrive } from "../store/drive";
import type { AccountInfo, ChannelRef } from "../lib/types";

type Step = "api" | "phone" | "code" | "password" | "channel";

export default function LoginWizard() {
  const { signedIn, dark } = useDrive();
  const saved = useRef(loadSavedConnection());

  const [step, setStep] = useState<Step>("api");
  const apiId = (import.meta as any).env.VITE_API_ID || "38615406";
  const apiHash = (import.meta as any).env.VITE_API_HASH || "PASTE_YOUR_API_HASH_HERE";
  const persist = true;

  const [phone, setPhone] = useState("");
  const [codeHash, setCodeHash] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);

  const [channels, setChannels] = useState<ChannelRef[] | null>(null);
  const [filter, setFilter] = useState("");
  const [manual, setManual] = useState("");

  const [qrMode, setQrMode] = useState(false);
  const [qrToken, setQrToken] = useState<string | null>(null);

  const clientRef = useRef<TgClient | null>(null);

  const input =
    "w-full rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/20 transition";

  function newClient() {
    const c = new TgClient(Number(apiId), apiHash.trim(), persist);
    clientRef.current = c;
    return c;
  }

  async function run<T>(fn: () => Promise<T>, after?: (r: T) => void) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      after?.(r);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  /* try to resume a stored session instead of asking for the code again */
  async function startWithApi() {
    await run(
      async () => {
        const c = newClient();
        if (hasPersistedSession()) {
          try {
            const me = await c.getMe();
            if (me.userId) return { me, resumed: true as const };
          } catch {
            wipePersistedSession();
          }
        }
        return { me: null, resumed: false as const };
      },
      (r) => {
        if (r.resumed && r.me) {
          setAccount(r.me);
          if (saved.current?.channel) {
            // bypass channel selection if we already have one
            signedIn(
              clientRef.current!,
              { apiId: Number(apiId), apiHash: apiHash.trim(), account: r.me, channel: saved.current.channel },
              persist
            );
          } else {
            void loadChannelList();
            setStep("channel");
          }
        } else {
          setStep("phone");
        }
      },
    );
  }

  async function sendCode() {
    await run(
      async () => {
        const c = clientRef.current ?? newClient();
        return c.sendCode(phone.trim());
      },
      (r: any) => {
        setCodeHash(r.phone_code_hash);
        setStep("code");
      },
    );
  }

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const c = clientRef.current!;
      const res: any = await c.signIn(phone.trim(), codeHash, code.trim());
      if (res._ === "auth.authorizationSignUpRequired") {
        setError("This phone number has no Telegram account. Create one in the Telegram app first.");
        return;
      }
      await afterAuth();
    } catch (e: any) {
      if (String(e?.message ?? "").includes("Two-step verification")) {
        setStep("password");
        setError(null);
      } else {
        setError(e?.message ?? "Sign-in failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword() {
    await run(
      async () => {
        await clientRef.current!.checkPassword(password);
      },
      () => void afterAuth(),
    );
  }

  async function afterAuth() {
    const me = await clientRef.current!.getMe();
    setAccount(me);
    setStep("channel");
    void loadChannelList();
  }

  async function loadChannelList() {
    setBusy(true);
    setError(null);
    try {
      setChannels(await listChannels(clientRef.current!));
    } catch (e: any) {
      setError(e?.message ?? "Could not load your channel list.");
      setChannels([]);
    } finally {
      setBusy(false);
    }
  }

  function choose(ch: ChannelRef) {
    if (!clientRef.current || !account) return;
    signedIn(
      clientRef.current,
      { apiId: Number(apiId), apiHash: apiHash.trim(), account, channel: ch },
      persist,
    );
  }

  async function resolveManual() {
    await run(
      () => resolveChannel(clientRef.current!, manual.trim()),
      (ch) => choose(ch),
    );
  }

  useEffect(() => {
    void startWithApi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll for QR Code Login
  useEffect(() => {
    if (step !== "phone" || !qrMode) return;
    let timer: any;
    let cancel = false;

    async function poll() {
      try {
        const c = clientRef.current ?? newClient();
        const res = await c.exportLoginToken();
        if (cancel) return;

        if (res._ === "auth.loginToken") {
          // encode token (Uint8Array) to base64url
          const str = String.fromCharCode.apply(null, Array.from(res.token));
          const b64 = btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
          setQrToken(`tg://login?token=${b64}`);
          timer = setTimeout(poll, 10000); // Poll again in 10s
        } else if (res._ === "auth.loginTokenSuccess") {
          await afterAuth();
        } else if (res._ === "auth.loginTokenMigrateTo") {
          try {
            const imported = await c.importLoginToken(res.token, res.dc_id);
            if (imported._ === "auth.loginTokenSuccess") {
              await afterAuth();
            } else {
              timer = setTimeout(poll, 10000);
            }
          } catch (e) {
            timer = setTimeout(poll, 10000);
          }
        } else {
          timer = setTimeout(poll, 10000);
        }
      } catch (e) {
        if (!cancel) timer = setTimeout(poll, 10000);
      }
    }

    void poll();
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [step, qrMode]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || busy) return;
      if (step === "phone" && phone) void sendCode();
      else if (step === "code" && code) void signIn();
      else if (step === "password" && password) void submitPassword();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const list = (channels ?? []).filter((c) =>
    c.title.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div className="h-full w-full overflow-auto bg-bg">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background: dark
            ? "radial-gradient(900px 480px at 15% -10%, rgba(139,139,240,.18), transparent 60%), radial-gradient(700px 400px at 95% 10%, rgba(56,189,248,.12), transparent 60%)"
            : "radial-gradient(900px 480px at 15% -10%, rgba(91,91,214,.16), transparent 60%), radial-gradient(700px 420px at 95% 5%, rgba(56,189,248,.14), transparent 60%)",
        }}
      />
      <div className="relative mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-12">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/25">
            <Cloud size={22} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Telegram Cloud Drive</h1>
            <p className="text-sm text-muted">
              Sign in with your own Telegram account — no bots involved.
            </p>
          </div>
        </div>

        <Steps step={step} />

        <div className="rounded-2xl border border-line bg-panel p-6 shadow-sm anim-in">
          {step === "api" && (
            <div className="flex flex-col items-center justify-center space-y-4 py-8 text-muted">
              <Loader2 className="animate-spin" size={24} />
              <p>Connecting to Telegram...</p>
            </div>
          )}

          {step === "phone" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-line pb-4">
                <h2 className="text-base font-semibold">Sign In</h2>
                <div className="flex rounded-lg bg-ink/5 p-1">
                  <button
                    className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                      !qrMode ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink"
                    }`}
                    onClick={() => setQrMode(false)}
                  >
                    Phone
                  </button>
                  <button
                    className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                      qrMode ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink"
                    }`}
                    onClick={() => setQrMode(true)}
                  >
                    QR Code
                  </button>
                </div>
              </div>

              {qrMode ? (
                <div className="flex flex-col items-center justify-center space-y-6 py-4">
                  <p className="text-center text-sm text-muted max-w-sm">
                    Open Telegram on your phone, go to <b>Settings</b> → <b>Devices</b> →{" "}
                    <b>Link Desktop Device</b>, and point your camera at this screen.
                  </p>
                  <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
                    {qrToken ? (
                      <QRCodeSVG value={qrToken} size={200} level="M" />
                    ) : (
                      <div className="flex h-[200px] w-[200px] items-center justify-center text-muted">
                        <Loader2 className="animate-spin" size={24} />
                      </div>
                    )}
                  </div>
                  <Err error={error} />
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted mt-2">
                    Telegram will send a login code to your other Telegram sessions (or by SMS).
                  </p>
                  <div className="relative">
                    <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      className={input + " pl-9 font-mono"}
                      inputMode="tel"
                      placeholder="+1 234 567 8900"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                  <Err error={error} />
                  <div className="flex gap-2.5">
                    <Primary busy={busy} disabled={phone.trim().length < 6} onClick={sendCode}>
                      Send code
                    </Primary>
                  </div>
                </>
              )}
            </div>
          )}

          {step === "code" && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold">Login code</h2>
              <p className="text-sm text-muted">
                Enter the code Telegram sent to <b>{phone}</b>.
              </p>
              <div className="relative">
                <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  className={input + " pl-8 font-mono tracking-[0.3em]"}
                  placeholder="12345"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <Err error={error} />
              <div className="flex gap-2.5">
                <Secondary onClick={() => setStep("phone")}>Back</Secondary>
                <Secondary
                  onClick={() =>
                    void run(
                      () => clientRef.current!.resendCode(phone.trim(), codeHash),
                      (r: any) => setCodeHash(r.phone_code_hash ?? codeHash),
                    )
                  }
                >
                  Resend
                </Secondary>
                <Primary busy={busy} disabled={code.length < 4} onClick={signIn}>
                  Sign in
                </Primary>
              </div>
            </div>
          )}

          {step === "password" && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold">Two-step verification</h2>
              <p className="text-sm text-muted">
                Your account is protected by a password. It is verified with Telegram's SRP
                protocol — the password itself never leaves this device.
              </p>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  className={input + " pl-8 pr-10"}
                  type={showPass ? "text" : "password"}
                  placeholder="Cloud password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <Err error={error} />
              <Primary busy={busy} disabled={!password} onClick={submitPassword}>
                Verify
              </Primary>
            </div>
          )}

          {step === "channel" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={16} />
                Signed in as {account?.firstName ?? "you"}
                {account?.username ? ` (@${account.username})` : ""}
              </div>
              <h2 className="text-base font-semibold">Choose the channel to use as storage</h2>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  className={input + " pl-8"}
                  placeholder="Filter your channels…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>

              <div className="max-h-64 space-y-1.5 overflow-y-auto">
                {busy && !channels && (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted">
                    <Loader2 size={16} className="animate-spin" /> Loading your channels…
                  </div>
                )}
                {channels && list.length === 0 && !busy && (
                  <p className="py-4 text-sm text-muted">
                    No channels found in your first 100 dialogs. Use the field below to enter a
                    public @username, or create a private channel in Telegram first.
                  </p>
                )}
                {list.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => choose(c)}
                    className="group flex w-full items-center gap-3 rounded-xl border border-line px-3.5 py-2.5 text-left transition hover:border-accent hover:bg-accent/5"
                  >
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-[12px] font-semibold text-accent">
                      {c.title.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{c.title}</div>
                      <div className="truncate text-[11.5px] text-muted">
                        {c.isPrivate ? "Private" : `@${c.username}`} ·{" "}
                        {c.isBroadcast ? "channel" : "supergroup"}
                        {c.canDelete ? " · can delete" : " · no delete rights"}
                      </div>
                    </div>
                    <ArrowRight
                      size={16}
                      className="text-muted transition group-hover:translate-x-0.5 group-hover:text-accent"
                    />
                  </button>
                ))}
              </div>

              <div className="flex gap-2.5">
                <div className="relative flex-1">
                  <Hash size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    className={input + " pl-8"}
                    placeholder="…or a public @username"
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                  />
                </div>
                <button
                  disabled={!manual.trim() || busy}
                  onClick={resolveManual}
                  className="rounded-xl border border-line px-4 text-sm font-medium hover:bg-ink/5 disabled:opacity-40"
                >
                  Use
                </button>
              </div>
              <Err error={error} />
              <div className="flex items-start gap-2.5 rounded-xl bg-ink/[0.04] p-3.5 text-[12.5px] text-muted">
                <Info size={15} className="mt-0.5 shrink-0" />
                <p>
                  Files in a private channel are visible to its members and to Telegram's
                  servers. This is <b>not</b> end-to-end encrypted storage.
                </p>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted">
          MTProto over WebSocket, straight to Telegram · No database · No backend · No bots
          <br />
          <span className="inline-block mt-3 text-[10px] font-bold tracking-widest text-accent uppercase bg-accent/10 border border-accent/20 px-3 py-1 rounded-full shadow-sm">Developed by saicharansada</span>
        </p>
      </div>
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const order: Step[] = ["phone", "code", "password", "channel"];
  const labels: Record<Step, string> = {
    api: "API",
    phone: "Phone",
    code: "Code",
    password: "2FA",
    channel: "Channel",
  };
  const i = order.indexOf(step);
  return (
    <div className="flex items-center gap-2 text-[11.5px]">
      {order.map((s, idx) => (
        <div key={s} className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 ${
              idx === i
                ? "bg-accent text-white"
                : idx < i
                  ? "bg-accent/15 text-accent"
                  : "bg-ink/5 text-muted"
            }`}
          >
            {labels[s]}
          </span>
          {idx < order.length - 1 && <span className="h-px w-4 bg-line" />}
        </div>
      ))}
    </div>
  );
}

function Err({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">
      <AlertTriangle size={17} className="mt-0.5 shrink-0" />
      <span>{error}</span>
    </div>
  );
}

function Primary({
  children,
  onClick,
  busy,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

function Secondary({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-muted hover:bg-ink/5"
    >
      {children}
    </button>
  );
}

function Note() {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-ink/[0.04] p-3.5 text-[12.5px] text-muted">
      <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-500" />
      <p>
        Signing in with your account (MTProto) is what makes full channel history, 2 GB
        uploads and unrestricted downloads possible — none of which a bot can do.
      </p>
    </div>
  );
}
