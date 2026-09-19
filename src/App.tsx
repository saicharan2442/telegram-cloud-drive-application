import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Upload,
  RefreshCw,
  LayoutGrid,
  List as ListIcon,
  ArrowUpDown,
  Loader2,
  X,
  CheckCircle2,
  AlertTriangle,
  Info,
  ArrowUpCircle,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { DriveProvider, useDrive } from "./store/drive";
import Sidebar, { type Route } from "./components/Sidebar";
import Dashboard from "./components/Dashboard";
import FileBrowser from "./components/FileBrowser";
import LinksBrowser from "./components/LinksBrowser";
import DetailsPanel from "./components/DetailsPanel";
import PreviewModal from "./components/PreviewModal";
import TransfersPanel from "./components/TransfersPanel";
import SettingsPage from "./components/SettingsPage";
import LoginWizard from "./components/LoginWizard";
import { CATEGORIES, categoryLabel } from "./lib/categories";
import type { CategoryId, DriveFile, SortKey } from "./lib/types";
import { formatBytes } from "./lib/format";

function Shell() {
  const {
    conn,
    files,
    loading,
    refresh,
    settings,
    setSettings,
    queueUploads,
    deleteFiles,
    transfers,
    toasts,
    dismissToast,
    lastSync,
    scanned,
    channelTotal,
    hasMore,
    loadMore,
    loadAll,
    loadingMore,
    downloadFile,
    downloadMultipleFiles,
  } = useDrive();

  const [route, setRoute] = useState<Route>({ page: "home" });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<DriveFile | null>(null);
  const [showTransfers, setShowTransfers] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<File[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DriveFile[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);

  /* ---------- derived, in-memory only ---------- */
  const counts = useMemo(() => {
    const c = Object.fromEntries(CATEGORIES.map((x) => [x.id, 0])) as Record<CategoryId, number>;
    for (const f of files) c[f.category]++;
    return c;
  }, [files]);

  const visible = useMemo(() => {
    const cat = route.page === "files" ? route.category : undefined;
    const q = query.trim().toLowerCase();
    let out = files;
    if (cat) out = out.filter((f) => f.category === cat);
    if (q)
      out = out.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.ext.includes(q.replace(/^\./, "")) ||
          categoryLabel(f.category).toLowerCase().includes(q),
      );
    const dir = settings.sortDir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      if (settings.sortKey === "name") return a.name.localeCompare(b.name) * dir;
      if (settings.sortKey === "size") return ((a.size ?? 0) - (b.size ?? 0)) * dir;
      return ((a.date ?? 0) - (b.date ?? 0)) * dir;
    });
  }, [files, route, query, settings.sortKey, settings.sortDir]);

  const selectedFiles = useMemo(
    () => files.filter((f) => selected.has(f.key)),
    [files, selected],
  );

  const activeTransfers = transfers.filter(
    (t) => t.state === "running" || t.state === "queued",
  ).length;

  /* ---------- selection ---------- */
  const lastIndex = useRef<number>(-1);
  const onSelect = useCallback(
    (key: string, mode: "single" | "toggle" | "range") => {
      const idx = visible.findIndex((f) => f.key === key);
      setSelected((prev) => {
        const next = new Set(prev);
        if (mode === "single") {
          next.clear();
          next.add(key);
        } else if (mode === "toggle") {
          next.has(key) ? next.delete(key) : next.add(key);
        } else {
          const from = lastIndex.current >= 0 ? lastIndex.current : idx;
          const [a, b] = [Math.min(from, idx), Math.max(from, idx)];
          for (let i = a; i <= b; i++) next.add(visible[i].key);
        }
        return next;
      });
      lastIndex.current = idx;
    },
    [visible],
  );

  const onSelectMany = useCallback((keys: string[], replace: boolean, base?: Set<string>) => {
    setSelected((prev) => {
      const next = replace ? new Set<string>() : new Set(base || prev);
      for (const k of keys) next.add(k);
      return next;
    });
  }, []);

  /* ---------- uploads ---------- */
  const pickFiles = useCallback(() => inputRef.current?.click(), []);
  const onPicked = (list: FileList | null) => {
    if (!list || !list.length) return;
    setPendingUploads(Array.from(list));
  };

  /* ---------- keyboard shortcuts ---------- */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const typing =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement;
      if (e.ctrlKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setRoute((r) => (r.page === "settings" ? { page: "files" } : r));
        searchRef.current?.focus();
      } else if (e.ctrlKey && e.key.toLowerCase() === "u") {
        e.preventDefault();
        if (conn?.channel.canPost) pickFiles();
      } else if (e.key === "F5") {
        e.preventDefault();
        void refresh();
      } else if (e.key === "Delete" && !typing && selectedFiles.length) {
        e.preventDefault();
        if (conn?.channel.canDelete) setConfirmDelete(selectedFiles);
      } else if (e.key === "Escape") {
        if (pendingUploads) setPendingUploads(null);
        else if (confirmDelete) setConfirmDelete(null);
        else if (preview) setPreview(null);
        else if (selected.size) setSelected(new Set());
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [pickFiles, refresh, selectedFiles, selected.size, preview, pendingUploads, confirmDelete]);

  /* ---------- drag & drop (only inside the drop zone) ---------- */
  const dropProps = {
    onDragEnter: (e: React.DragEvent) => {
      if (!conn?.channel.canPost) return;
      if (!e.dataTransfer.types.includes("Files")) return;
      dragDepth.current++;
      setDragging(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!conn?.channel.canPost) return;
      if (e.dataTransfer.types.includes("Files")) e.preventDefault();
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (!conn?.channel.canPost) return;
      const list = Array.from(e.dataTransfer.files ?? []);
      if (list.length) setPendingUploads(list);
    },
  };

  const title =
    route.page === "home"
      ? "Home"
      : route.page === "settings"
        ? "Settings"
        : route.category
          ? categoryLabel(route.category)
          : "All Files";

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg text-ink">
      <Sidebar route={route} setRoute={setRoute} counts={counts} total={files.length} />

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* header */}
        <header className="flex items-center gap-3 border-b border-line bg-panel/60 px-5 py-2.5 backdrop-blur">
          <div className="min-w-0">
            <div className="text-[11px] text-muted">
              {conn?.channel.title}
              {route.page === "files" && route.category ? ` / ${title}` : ""}
            </div>
            <h1 className="truncate text-[15px] font-semibold leading-tight">{title}</h1>
          </div>

          <div className="relative ml-4 max-w-md flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (route.page === "home") setRoute({ page: "files" });
              }}
              placeholder="Search loaded files  (Ctrl+F)"
              className="w-full rounded-xl border border-line bg-panel py-2 pl-9 pr-8 text-[13px] outline-none placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:bg-ink/5"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <div className="mr-3 flex items-center justify-center">
              <div className="badge-glow px-4 py-0.5 rounded-full">
                <span className="badge-shine text-[11.5px] font-extrabold uppercase tracking-[0.15em] whitespace-nowrap">
                  Developed by saicharansada
                </span>
              </div>
            </div>
            {route.page === "files" && (
              <button
                onClick={() => setSelected(new Set(visible.map(f => f.key)))}
                className="rounded-xl border border-line px-3 py-1.5 text-[13px] font-medium hover:bg-ink/5"
              >
                Select All
              </button>
            )}
            {route.page !== "settings" && (
              <>
                <button
                  onClick={() =>
                    setSettings({ view: settings.view === "grid" ? "list" : "grid" })
                  }
                  title="Switch view"
                  className="rounded-xl border border-line p-2 hover:bg-ink/5"
                >
                  {settings.view === "grid" ? <ListIcon size={16} /> : <LayoutGrid size={16} />}
                </button>
                <div className="flex items-center gap-1 rounded-xl border border-line px-2 py-1">
                  <ArrowUpDown size={14} className="text-muted" />
                  <select
                    value={settings.sortKey}
                    onChange={(e) => setSettings({ sortKey: e.target.value as SortKey })}
                    className="bg-transparent text-[12.5px] outline-none"
                  >
                    <option value="date">Date</option>
                    <option value="name">Name</option>
                    <option value="size">Size</option>
                  </select>
                  <button
                    className="rounded px-1 text-[12px] text-muted hover:bg-ink/5"
                    onClick={() =>
                      setSettings({ sortDir: settings.sortDir === "asc" ? "desc" : "asc" })
                    }
                  >
                    {settings.sortDir === "asc" ? "↑" : "↓"}
                  </button>
                </div>
              </>
            )}
            <button
              onClick={() => setShowTransfers((s) => !s)}
              title="Transfers"
              className="relative rounded-xl border border-line p-2 hover:bg-ink/5"
            >
              <ArrowUpCircle size={16} />
              {activeTransfers > 0 && (
                <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
                  {activeTransfers}
                </span>
              )}
            </button>
            <button
              onClick={() => void refresh()}
              disabled={loading}
              title="Refresh (F5)"
              className="rounded-xl border border-line p-2 hover:bg-ink/5 disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            </button>
            {conn?.channel.canPost && (
              <button
                onClick={pickFiles}
                className="flex items-center gap-2 rounded-xl bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90"
              >
                <Upload size={15} /> Upload
              </button>
            )}
          </div>
        </header>

        {showTransfers && <TransfersPanel onClose={() => setShowTransfers(false)} />}

        {/* content + details */}
        <div className="flex min-h-0 flex-1">
          <main
            {...dropProps}
            className="relative min-w-0 flex-1 overflow-y-auto p-5"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setSelected(new Set());
            }}
          >
            {route.page === "home" && (
              <Dashboard
                files={files}
                counts={counts}
                setRoute={setRoute}
                onUpload={pickFiles}
                onOpen={(f) => setPreview(f)}
              />
            )}

            {route.page === "files" && (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
                  <span>
                    {visible.length} file{visible.length === 1 ? "" : "s"}
                    {query && " matching your search"} ·{" "}
                    {formatBytes(visible.reduce((a, f) => a + (f.size ?? 0), 0))}
                  </span>
                  <span className="flex items-center gap-2">
                    {hasMore ? (
                      <>
                        Searching {files.length} of {channelTotal ?? "?"} — {scanned} messages read
                        <button
                          onClick={() => void loadMore()}
                          disabled={loadingMore}
                          className="rounded-lg border border-line px-2 py-1 hover:bg-ink/5 disabled:opacity-50"
                        >
                          {loadingMore ? "Loading…" : "Load older"}
                        </button>
                        <button
                          onClick={() => void loadAll()}
                          disabled={loadingMore}
                          className="rounded-lg border border-line px-2 py-1 hover:bg-ink/5 disabled:opacity-50"
                        >
                          Scan whole channel
                        </button>
                      </>
                    ) : (
                      <>
                        Whole channel scanned ({scanned} messages)
                        {lastSync ? ` · ${new Date(lastSync).toLocaleTimeString()}` : ""}
                      </>
                    )}
                  </span>
                </div>
                {route.category === "links" ? (
                  <LinksBrowser
                    files={visible}
                    emptyHint={
                      <div className="max-w-md space-y-2 text-sm">
                        <p className="font-medium text-ink">No links found</p>
                        <p>
                          {query
                            ? "No matching links in the history scanned so far. Use “Scan whole channel” above to search every message."
                            : "Load older history to pull in messages with links."}
                        </p>
                      </div>
                    }
                  />
                ) : (
                  <FileBrowser
                    files={visible}
                    view={settings.view}
                    selected={selected}
                    canDelete={conn?.channel.canDelete ?? false}
                    onSelect={onSelect}
                    onSelectMany={onSelectMany}
                    onOpen={(f) => setPreview(f)}
                    onDownload={(f) => {
                      if (selected.size > 1 && selected.has(f.key)) {
                        void downloadMultipleFiles(selectedFiles);
                      } else {
                        void downloadFile(f);
                      }
                    }}
                    onDelete={(f) =>
                      setConfirmDelete(selected.has(f.key) && selectedFiles.length > 1 ? selectedFiles : [f])
                    }
                    loading={loading}
                    emptyHint={
                      <div className="max-w-md space-y-2 text-sm">
                        <p className="font-medium text-ink">Nothing here yet</p>
                        <p>
                          {query
                            ? "No match in the history scanned so far. Use “Scan whole channel” above to search every message."
                            : (conn?.channel.canPost
                                ? "Upload files with the Upload button or drag them here, or load older history to pull in existing files."
                                : "Load older history to pull in existing files.")}
                        </p>
                      </div>
                    }
                  />
                )}
              </>
            )}

            {route.page === "settings" && <SettingsPage />}

            {dragging && (
              <div className="pointer-events-none absolute inset-3 z-30 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-accent/10 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-2 text-accent">
                  <UploadCloud size={34} />
                  <p className="text-sm font-medium">Drop files to upload to Telegram</p>
                </div>
              </div>
            )}
          </main>

          {selectedFiles.length > 0 && route.page === "files" && (
            <DetailsPanel
              file={selectedFiles[selectedFiles.length - 1]}
              selectedFiles={selectedFiles}
              count={selectedFiles.length}
              onClose={() => setSelected(new Set())}
              onPreview={() => setPreview(selectedFiles[selectedFiles.length - 1])}
              onDelete={() => setConfirmDelete(selectedFiles)}
            />
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          onPicked(e.target.files);
          e.target.value = "";
        }}
      />

      {preview && (
        <PreviewModal
          file={preview}
          siblings={visible.length ? visible : files}
          onClose={() => setPreview(null)}
          onNavigate={setPreview}
        />
      )}

      {/* upload confirmation */}
      {pendingUploads && (
        <Modal onClose={() => setPendingUploads(null)}>
          <h3 className="text-base font-semibold">Upload {pendingUploads.length} file(s)?</h3>
          <p className="mt-1 text-[12.5px] text-muted">
            Files are sent as documents to <b>{conn?.channel.title}</b>, in 512 KB chunks. Your
            local copies are never moved or deleted. Limit: 2 GB per file.
          </p>
          <div className="my-3 max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
            {pendingUploads.map((f, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-1.5 py-1 text-[12.5px]">
                <span className="truncate">{f.name}</span>
                <span className={f.size > 2 * 1024 * 1024 * 1024 ? "text-rose-500" : "text-muted"}>
                  {formatBytes(f.size)}
                </span>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2.5">
            <button
              className="rounded-xl px-4 py-2 text-sm text-muted hover:bg-ink/5"
              onClick={() => setPendingUploads(null)}
            >
              Cancel
            </button>
            <button
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              onClick={() => {
                queueUploads(pendingUploads);
                setPendingUploads(null);
                setShowTransfers(true);
              }}
            >
              Upload
            </button>
          </div>
        </Modal>
      )}

      {/* delete confirmation */}
      {confirmDelete && (
        <Modal onClose={() => !deleting && setConfirmDelete(null)}>
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-rose-500/12 text-rose-500">
              <Trash2 size={17} />
            </div>
            <div>
              <h3 className="text-base font-semibold">
                Delete {confirmDelete.length > 1 ? `${confirmDelete.length} files` : "this file"}{" "}
                from Telegram?
              </h3>
              <p className="mt-1 text-[12.5px] text-muted">
                This deletes the message in <b>{conn?.channel.title}</b> for everyone. It cannot
                be undone and needs delete rights in the channel. Local files are untouched.
              </p>
            </div>
          </div>
          <div className="my-3 max-h-40 overflow-y-auto rounded-xl border border-line p-2 text-[12.5px]">
            {confirmDelete.map((f) => (
              <div key={f.key} className="truncate px-1.5 py-0.5">
                {f.name}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2.5">
            <button
              disabled={deleting}
              className="rounded-xl px-4 py-2 text-sm text-muted hover:bg-ink/5"
              onClick={() => setConfirmDelete(null)}
            >
              Cancel
            </button>
            <button
              disabled={deleting}
              className="flex items-center gap-2 rounded-xl bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              onClick={async () => {
                setDeleting(true);
                await deleteFiles(confirmDelete);
                setDeleting(false);
                setConfirmDelete(null);
                setSelected(new Set());
              }}
            >
              {deleting && <Loader2 size={15} className="animate-spin" />} Delete
            </button>
          </div>
        </Modal>
      )}

      {/* toasts */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] w-80 space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line bg-panel p-3 text-[12.5px] shadow-lg anim-in"
          >
            {t.kind === "success" && <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" />}
            {t.kind === "error" && <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose-500" />}
            {t.kind === "info" && <Info size={16} className="mt-0.5 shrink-0 text-accent" />}
            <span className="flex-1">{t.text}</span>
            <button className="text-muted hover:text-ink" onClick={() => dismissToast(t.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[55] grid place-items-center bg-black/50 p-6 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-5 shadow-2xl anim-in">
        {children}
      </div>
    </div>
  );
}

function Bridge() {
  const { conn, client } = useDrive();
  return conn && client ? <Shell /> : <LoginWizard />;
}

export default function App() {
  return (
    <DriveProvider>
      <Bridge />
    </DriveProvider>
  );
}
