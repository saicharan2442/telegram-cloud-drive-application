import { Upload, RefreshCw, Loader2, ShieldAlert, Clock } from "lucide-react";
import type { CategoryId, DriveFile } from "../lib/types";
import { CATEGORIES } from "../lib/categories";
import { CategoryIcon, Thumb } from "./FileVisual";
import { formatBytes, relativeDate } from "../lib/format";
import { useDrive } from "../store/drive";
import type { Route } from "./Sidebar";

export default function Dashboard({
  files,
  counts,
  setRoute,
  onUpload,
  onOpen,
}: {
  files: DriveFile[];
  counts: Record<CategoryId, number>;
  setRoute: (r: Route) => void;
  onUpload: () => void;
  onOpen: (f: DriveFile) => void;
}) {
  const {
    conn,
    refresh,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    lastSync,
    scanned,
    channelTotal,
    connState,
    connError,
    changeChannel,
  } = useDrive();

  const withSize = files.filter((f) => typeof f.size === "number");
  const totalSize = withSize.reduce((a, f) => a + (f.size ?? 0), 0);
  const recent = [...files].sort((a, b) => (b.date ?? 0) - (a.date ?? 0)).slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-indigo-500/10 via-violet-500/5 to-transparent p-6">
        <h1 className="text-[22px] font-semibold tracking-tight">
          Welcome back to your Telegram Drive
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Signed in as{" "}
          <b className="text-ink">
            {conn?.account.firstName ?? "your account"}
            {conn?.account.username ? ` (@${conn.account.username})` : ""}
          </b>
          , storing files in <b className="text-ink">{conn?.channel.title}</b>. Telegram is the
          only source of truth — this app keeps no database and no server-side copy.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {conn?.channel.canPost && (
            <button
              onClick={onUpload}
              className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90"
            >
              <Upload size={16} /> Upload files
            </button>
          )}
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-2 text-sm font-medium hover:bg-ink/5 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            Refresh from Telegram
          </button>
          <button
            onClick={() => void changeChannel()}
            className="flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-2 text-sm font-medium hover:bg-ink/5"
          >
            Change channel
          </button>
          {hasMore && (
            <button
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-2 text-sm font-medium hover:bg-ink/5 disabled:opacity-50"
            >
              {loadingMore ? <Loader2 size={16} className="animate-spin" /> : <Clock size={16} />}
              Load older history
            </button>
          )}
          <span className="text-xs text-muted">
            {lastSync
              ? `Synced ${new Date(lastSync).toLocaleTimeString()} · ${scanned} messages read${
                  channelTotal ? ` of ${channelTotal}` : ""
                }`
              : "Not synced yet"}
          </span>
        </div>
      </div>

      {connState === "error" && connError && (
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-sm text-rose-600 dark:text-rose-300">
          <ShieldAlert size={17} className="mt-0.5 shrink-0" />
          <div>
            <b>Telegram request failed.</b> {connError}
            <button className="ml-2 underline" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3.5">
        <Stat
          label="Files loaded so far"
          value={String(files.length)}
          hint={
            hasMore
              ? "Partial: older history not scanned yet"
              : "Complete: the whole channel history was scanned"
          }
        />
        <Stat
          label="Approximate total size"
          value={formatBytes(totalSize)}
          hint={`Sum of ${withSize.length}/${files.length} loaded files that reported a size`}
        />
        <Stat
          label="Storage capacity"
          value="Not published"
          hint="Telegram exposes no quota for channels — no number is invented here"
        />
      </div>

      <section>
        <h2 className="mb-2.5 text-sm font-semibold">Categories</h2>
        <div className="grid grid-cols-4 gap-3">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setRoute({ page: "files", category: c.id })}
              className="flex items-center gap-3 rounded-xl border border-line bg-panel px-3.5 py-3 text-left transition hover:border-accent/50 hover:shadow-sm"
            >
              <CategoryIcon category={c.id} size={19} />
              <div>
                <div className="text-[13px] font-medium">{c.label}</div>
                <div className="text-[11.5px] text-muted">{counts[c.id]} files</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent files</h2>
          <button
            className="text-xs text-accent hover:underline"
            onClick={() => setRoute({ page: "files" })}
          >
            View all
          </button>
        </div>
        {recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
            <Clock size={20} className="mx-auto mb-2 opacity-60" />
            No files found in the history scanned so far. {conn?.channel.canPost ? "Upload something, or load" : "Load"} older
            history to keep reading back through the channel.
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3.5">
            {recent.map((f) => (
              <button
                key={f.key}
                onDoubleClick={() => onOpen(f)}
                onClick={() => onOpen(f)}
                className="overflow-hidden rounded-2xl border border-line bg-panel text-left transition hover:border-accent/50 hover:shadow-sm"
              >
                <Thumb file={f} iconSize={28} className="h-24 w-full bg-ink/[0.035]" />
                <div className="space-y-0.5 p-2.5">
                  <div className="truncate text-[12.5px] font-medium">{f.name}</div>
                  <div className="text-[11px] text-muted">
                    {formatBytes(f.size)} · {relativeDate(f.date)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-[11px] leading-snug text-muted">{hint}</div>
    </div>
  );
}
