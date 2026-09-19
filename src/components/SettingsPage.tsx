import { useState } from "react";
import {
  Sun,
  Moon,
  Monitor,
  LogOut,
  RefreshCw,
  Trash,
  ShieldCheck,
  Info,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useDrive } from "../store/drive";
import type { SortKey, ThemeMode, ViewMode } from "../lib/types";

function Section({
  title,
  children,
  desc,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {desc && <p className="mt-1 text-[12.5px] text-muted">{desc}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const {
    conn,
    settings,
    setSettings,
    disconnect,
    refresh,
    loading,
    pushToast,
    clearTempPreviews,
  } = useDrive();
  const [cleared, setCleared] = useState(false);

  const chip = (active: boolean) =>
    `flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm transition ${active ? "border-accent bg-accent/10 text-accent" : "border-line hover:bg-ink/5"
    }`;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <Section title="Telegram account & channel">
        <div className="grid grid-cols-2 gap-3 text-[13px]">
          <Info2
            label="Signed in as"
            value={
              conn
                ? `${conn.account.firstName ?? ""}${conn.account.username ? ` @${conn.account.username}` : ""}`.trim() ||
                conn.account.userId
                : "—"
            }
          />
          <Info2 label="Phone" value={conn?.account.phone ? `+${conn.account.phone}` : "—"} />
          <Info2 label="Channel" value={conn?.channel.title ?? "—"} />
          <Info2
            label="Visibility"
            value={conn ? (conn.channel.isPrivate ? "Private" : `@${conn.channel.username}`) : "—"}
          />
          <Info2 label="Channel ID" value={conn?.channel.id ?? "—"} />
          <Info2
            label="Can delete messages"
            value={conn?.channel.canDelete ? "Yes" : "Own messages only"}
            ok={conn?.channel.canDelete}
          />
        </div>
        <div className="flex flex-wrap gap-2.5 pt-1">
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-line px-4 py-2 text-sm hover:bg-ink/5 disabled:opacity-50"
          >
            <RefreshCw size={15} /> Reconnect & refresh
          </button>
          <button
            onClick={() => void disconnect()}
            className="flex items-center gap-2 rounded-xl border border-rose-500/30 px-4 py-2 text-sm text-rose-500 hover:bg-rose-500/10"
          >
            <LogOut size={15} /> Log out
          </button>
        </div>
        <p className="text-[11.5px] text-muted">
          Logging out calls <code>auth.logOut</code> on Telegram and erases the stored MTProto
          authorisation key from this device.
        </p>
      </Section>

      <Section title="Appearance">
        <div className="flex gap-2.5">
          {(
            [
              ["light", "Light", Sun],
              ["dark", "Dark", Moon],
              ["system", "System", Monitor],
            ] as [ThemeMode, string, any][]
          ).map(([v, label, Icon]) => (
            <button
              key={v}
              className={chip(settings.theme === v)}
              onClick={() => setSettings({ theme: v })}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Defaults">
        <div className="space-y-3">
          <Field label="Default view">
            <div className="flex gap-2.5">
              {(["grid", "list"] as ViewMode[]).map((v) => (
                <button key={v} className={chip(settings.view === v)} onClick={() => setSettings({ view: v })}>
                  {v === "grid" ? "Grid" : "List"}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Default sorting">
            <div className="flex gap-2.5">
              {(["name", "size", "date"] as SortKey[]).map((v) => (
                <button
                  key={v}
                  className={chip(settings.sortKey === v)}
                  onClick={() => setSettings({ sortKey: v })}
                >
                  {v[0].toUpperCase() + v.slice(1)}
                </button>
              ))}
              <button
                className={chip(false)}
                onClick={() =>
                  setSettings({ sortDir: settings.sortDir === "asc" ? "desc" : "asc" })
                }
              >
                {settings.sortDir === "asc" ? "Ascending" : "Descending"}
              </button>
            </div>
          </Field>
        </div>
      </Section>

      <Section
        title="Downloads & temporary data"
        desc="Downloads use the system save dialog when the platform provides one, so you pick the destination folder and Windows handles filename collisions. Nothing is written silently."
      >
        <button
          onClick={() => {
            // releases the in-memory blobs created for previews and thumbnails
            const n = clearTempPreviews();
            setCleared(true);
            pushToast("success", `Released ${n} temporary preview buffer${n === 1 ? "" : "s"}.`);
            setTimeout(() => setCleared(false), 2000);
          }}
          className="flex items-center gap-2 rounded-xl border border-line px-4 py-2 text-sm hover:bg-ink/5"
        >
          <Trash size={15} /> {cleared ? "Cleared" : "Clear temporary preview data"}
        </button>
      </Section>

      <Section title="Privacy & security">
        <ul className="space-y-2 text-[12.5px] text-muted">
          <li className="flex gap-2">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-500" />
            You are signed in with your own Telegram account over MTProto. The authorisation
            key stays on this device; your password is verified with SRP and never transmitted.
          </li>
          <li className="flex gap-2">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-500" />
            No database, no search index, no metadata file. Everything you see is rebuilt
            from Telegram at runtime and lives only in memory.
          </li>
          <li className="flex gap-2">
            <Info size={15} className="mt-0.5 shrink-0 text-amber-500" />
            A private channel is <b>not end-to-end encrypted</b>. Telegram's servers can
            access the stored files. Do not treat this as zero-knowledge storage.
          </li>
          <li className="flex gap-2">
            <Info size={15} className="mt-0.5 shrink-0 text-amber-500" />
            Client API limits: 2 GB per uploaded file, downloads fetched in 512 KB chunks, and
            history read page by page so large channels stay responsive.
          </li>
        </ul>
      </Section>

      <Section title="About">
        <p className="text-[12.5px] text-muted">
          Telegram Cloud Drive · version 1.0.0 · React + TypeScript + Vite UI, packaged for
          Windows with Tauri 2 (see DOCS.md). No analytics, no tracking, no ads.
        </p>
      </Section>
    </div>
  );
}

function Info2({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="rounded-xl border border-line px-3.5 py-2.5">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="mt-0.5 flex items-center gap-1.5 truncate font-medium">
        {ok === true && <CheckCircle2 size={14} className="text-emerald-500" />}
        {ok === false && <XCircle size={14} className="text-rose-500" />}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[12.5px] text-muted">{label}</div>
      {children}
    </div>
  );
}
