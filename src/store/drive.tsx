import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { TgClient, TgError, wipePersistedSession } from "../lib/mtproto";
import {
  deleteMessages,
  downloadBlob,
  downloadThumb,
  loadHistoryPage,
  MAX_UPLOAD,
  uploadFile,
  verifyChannel,
} from "../lib/tgdrive";
import type { Connection, DriveFile, Settings, Transfer } from "../lib/types";

const SETTINGS_KEY = "tcd.settings";
const CONN_KEY = "tcd.connection"; // api id/hash + chosen channel (NOT a file index)

const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  view: "grid",
  sortKey: "date",
  sortDir: "desc",
};

export interface Toast {
  id: string;
  kind: "success" | "error" | "info";
  text: string;
}

interface DriveCtx {
  settings: Settings;
  setSettings: (s: Partial<Settings>) => void;
  dark: boolean;

  conn: Connection | null;
  client: TgClient | null;
  signedIn: (client: TgClient, conn: Connection, persist: boolean) => void;
  disconnect: () => Promise<void>;
  changeChannel: () => void;
  connState: "online" | "offline" | "error";
  connError: string | null;

  files: DriveFile[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  scanned: number;
  channelTotal?: number;
  lastSync: number | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  loadAll: (onTick?: (n: number) => void) => Promise<void>;

  transfers: Transfer[];
  queueUploads: (files: File[]) => void;
  retryTransfer: (id: string) => void;
  cancelTransfer: (id: string) => void;
  clearFinished: () => void;

  downloadFile: (f: DriveFile) => Promise<void>;
  downloadMultipleFiles: (files: DriveFile[]) => Promise<void>;
  deleteFiles: (fs: DriveFile[]) => Promise<{ ok: number; failed: number }>;
  getMediaUrl: (f: DriveFile, onProgress?: (n: number) => void) => Promise<string>;
  getThumbUrl: (f: DriveFile) => Promise<string | null>;
  clearTempPreviews: () => number;

  toasts: Toast[];
  pushToast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: string) => void;
}

const Ctx = createContext<DriveCtx | null>(null);
export const useDrive = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDrive outside provider");
  return c;
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS;
}

export function loadSavedConnection(): Connection | null {
  try {
    const raw = localStorage.getItem(CONN_KEY);
    return raw ? (JSON.parse(raw) as Connection) : null;
  } catch {
    return null;
  }
}

const PAGE = 60;

export function DriveProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [conn, setConn] = useState<Connection | null>(null);
  const [client, setClient] = useState<TgClient | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [scanned, setScanned] = useState(0);
  const [channelTotal, setChannelTotal] = useState<number | undefined>();
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [connState, setConnState] = useState<"online" | "offline" | "error">(
    navigator.onLine ? "online" : "offline",
  );
  const [connError, setConnError] = useState<string | null>(null);

  const offsetRef = useRef(0);
  const blobUrls = useRef(new Map<string, string>()); // temp preview/thumb URLs
  const uploading = useRef(false);

  /* ---------------------------------------------------------- preferences */
  const setSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  const dark = settings.theme === "dark" || (settings.theme === "system" && systemDark);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    const on = () => setConnState("online");
    const off = () => setConnState("offline");
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const pushToast = useCallback((kind: Toast["kind"], text: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  const dismissToast = useCallback(
    (id: string) => setToasts((t) => t.filter((x) => x.id !== id)),
    [],
  );

  /* ---------------------------------------------------------- connection */
  const signedIn = useCallback(
    (c: TgClient, connection: Connection, persist: boolean) => {
      setClient(c);
      setConn(connection);
      setConnError(null);
      setConnState(navigator.onLine ? "online" : "offline");
      setFiles([]);
      offsetRef.current = 0;
      setScanned(0);
      setHasMore(true);
      if (persist) {
        try {
          localStorage.setItem(CONN_KEY, JSON.stringify(connection));
        } catch {
          /* ignore */
        }
      } else {
        localStorage.removeItem(CONN_KEY);
      }
    },
    [],
  );

  const clearTempPreviews = useCallback(() => {
    const n = blobUrls.current.size;
    for (const url of blobUrls.current.values()) URL.revokeObjectURL(url);
    blobUrls.current.clear();
    return n;
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await client?.logOut();
    } catch {
      /* ignore */
    }
    clearTempPreviews();
    wipePersistedSession();
    localStorage.removeItem(CONN_KEY);
    setClient(null);
    setConn(null);
    setFiles([]);
    setTransfers([]);
    offsetRef.current = 0;
    setScanned(0);
    setHasMore(true);
    setChannelTotal(undefined);
    setLastSync(null);
  }, [client, clearTempPreviews]);

  const changeChannel = useCallback(() => {
    clearTempPreviews();
    try {
      const str = localStorage.getItem(CONN_KEY);
      if (str) {
        const conn = JSON.parse(str);
        delete conn.channel;
        localStorage.setItem(CONN_KEY, JSON.stringify(conn));
      }
    } catch {}
    setConn(null);
    setFiles([]);
    setTransfers([]);
    offsetRef.current = 0;
    setScanned(0);
    setHasMore(true);
    setChannelTotal(undefined);
    setLastSync(null);
  }, [clearTempPreviews]);

  /* ------------------------------------------------ incremental history */
  const merge = useCallback((incoming: DriveFile[]) => {
    if (!incoming.length) return;
    setFiles((prev) => {
      const map = new Map(prev.map((f) => [f.key, f]));
      for (const f of incoming) map.set(f.key, f);
      return [...map.values()];
    });
  }, []);

  const fetchPage = useCallback(
    async (offsetId: number) => {
      if (!client || !conn) return null;
      const page = await loadHistoryPage(client, conn.channel, offsetId, PAGE);
      merge(page.files);
      setScanned((n) => n + page.scanned);
      setChannelTotal(page.total);
      offsetRef.current = page.nextOffsetId ?? 0;
      setHasMore(page.nextOffsetId !== null);
      return page;
    },
    [client, conn, merge],
  );

  const handleError = useCallback(
    (e: unknown, fallback: string) => {
      const te = e as TgError;
      const msg = te?.message || fallback;
      setConnError(msg);
      setConnState("error");
      pushToast("error", msg);
    },
    [pushToast],
  );

  const refresh = useCallback(async () => {
    if (!client || !conn) return;
    if (!navigator.onLine) {
      setConnState("offline");
      pushToast("error", "You are offline. Reconnect and try again.");
      return;
    }
    setLoading(true);
    setConnError(null);
    try {
      await verifyChannel(client, conn.channel); // fails fast if access was lost
      setFiles([]);
      setScanned(0);
      offsetRef.current = 0;
      await fetchPage(0);
      setConnState("online");
      setLastSync(Date.now());
    } catch (e) {
      handleError(e, "Could not read the channel.");
    } finally {
      setLoading(false);
    }
  }, [client, conn, fetchPage, handleError, pushToast]);

  const loadMore = useCallback(async () => {
    if (!client || !conn || loadingMore || loading || !hasMore) return;
    setLoadingMore(true);
    try {
      await fetchPage(offsetRef.current);
      setLastSync(Date.now());
    } catch (e) {
      handleError(e, "Could not load more history.");
    } finally {
      setLoadingMore(false);
    }
  }, [client, conn, fetchPage, handleError, hasMore, loading, loadingMore]);

  /** Walk the whole channel, page by page, so search can cover everything. */
  const loadAll = useCallback(
    async (onTick?: (n: number) => void) => {
      if (!client || !conn) return;
      setLoadingMore(true);
      try {
        let guard = 0;
        while (offsetRef.current !== 0 || guard === 0) {
          const page = await fetchPage(offsetRef.current);
          guard++;
          onTick?.(guard * PAGE);
          if (!page || page.nextOffsetId === null) break;
          if (guard > 400) break; // ~24k messages safety stop
          await new Promise((r) => setTimeout(r, 120)); // be gentle with limits
        }
        setLastSync(Date.now());
      } catch (e) {
        handleError(e, "Stopped while scanning the channel history.");
      } finally {
        setLoadingMore(false);
      }
    },
    [client, conn, fetchPage, handleError],
  );

  // First page automatically, once, after sign-in.
  const bootFor = useRef<string | null>(null);
  useEffect(() => {
    if (client && conn && bootFor.current !== conn.channel.id) {
      bootFor.current = conn.channel.id;
      void refresh();
    }
  }, [client, conn, refresh]);

  /* ------------------------------------------------------------ uploads */
  const patch = useCallback((id: string, p: Partial<Transfer>) => {
    setTransfers((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));
  }, []);

  const pumpRef = useRef<() => void>(() => {});

  const runUpload = useCallback(
    async (t: Transfer) => {
      if (!client || !conn || !t.file) return;
      const ac = new AbortController();
      patch(t.id, { state: "running", loaded: 0, error: undefined, abort: () => ac.abort() });
      try {
        const created = await uploadFile(client, conn.channel, t.file, {
          signal: ac.signal,
          onProgress: (loaded) => patch(t.id, { loaded }),
        });
        if (created) merge([created]);
        patch(t.id, { state: "done", loaded: t.size ?? 0, abort: undefined });
        pushToast("success", `Uploaded “${t.name}” to ${conn.channel.title}.`);
      } catch (e: any) {
        if (e?.name === "AbortError") {
          patch(t.id, { state: "cancelled", abort: undefined });
          return;
        }
        patch(t.id, {
          state: "error",
          error: (e as TgError).message ?? "Upload failed",
          abort: undefined,
        });
        pushToast("error", `Upload of “${t.name}” failed: ${(e as Error).message}`);
      }
    },
    [client, conn, merge, patch, pushToast],
  );

  const pump = useCallback(() => {
    if (uploading.current) return;
    setTransfers((ts) => {
      const next = ts.find((t) => t.kind === "upload" && t.state === "queued");
      if (next) {
        uploading.current = true;
        void runUpload(next).finally(() => {
          uploading.current = false;
          setTimeout(() => pumpRef.current(), 40);
        });
      }
      return ts;
    });
  }, [runUpload]);
  pumpRef.current = pump;

  const queueUploads = useCallback(
    (list: File[]) => {
      if (!conn) return;
      const accepted: Transfer[] = [];
      for (const f of list) {
        if (f.size > MAX_UPLOAD) {
          pushToast("error", `“${f.name}” exceeds Telegram's 2 GB per-file limit.`);
          continue;
        }
        if (f.size === 0) {
          pushToast("error", `“${f.name}” is empty — Telegram rejects 0-byte files.`);
          continue;
        }
        accepted.push({
          id: Math.random().toString(36).slice(2),
          kind: "upload",
          name: f.name,
          size: f.size,
          loaded: 0,
          state: "queued",
          file: f,
        });
      }
      if (!accepted.length) return;
      setTransfers((ts) => [...accepted, ...ts]);
      setTimeout(() => pumpRef.current(), 20);
    },
    [conn, pushToast],
  );

  const retryTransfer = useCallback((id: string) => {
    setTransfers((ts) =>
      ts.map((t) => (t.id === id ? { ...t, state: "queued", loaded: 0, error: undefined } : t)),
    );
    setTimeout(() => pumpRef.current(), 20);
  }, []);

  const cancelTransfer = useCallback((id: string) => {
    setTransfers((ts) => {
      ts.find((x) => x.id === id)?.abort?.();
      return ts.map((x) =>
        x.id === id && (x.state === "queued" || x.state === "running")
          ? { ...x, state: "cancelled", abort: undefined }
          : x,
      );
    });
  }, []);

  const clearFinished = useCallback(
    () => setTransfers((ts) => ts.filter((t) => t.state === "queued" || t.state === "running")),
    [],
  );

  /* --------------------------------------------------- preview / thumbs */
  const getThumbUrl = useCallback(
    async (f: DriveFile) => {
      if (!client) return null;
      const key = `t:${f.key}`;
      const hit = blobUrls.current.get(key);
      if (hit) return hit;
      const blob = await downloadThumb(client, f);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      blobUrls.current.set(key, url);
      return url;
    },
    [client],
  );

  const getMediaUrl = useCallback(
    async (f: DriveFile, onProgress?: (n: number) => void) => {
      if (!client || !conn) throw new TgError("Not connected.", 0);
      const key = `f:${f.key}`;
      const hit = blobUrls.current.get(key);
      if (hit) return hit;
      // Telegram has no HTTP URL for media: previewing means fetching the bytes
      // into a temporary in-memory blob, which is released on Clear/disconnect.
      const blob = await downloadBlob(client, conn.channel, f, {
        onProgress: (loaded) => onProgress?.(loaded),
      });
      const url = URL.createObjectURL(blob);
      blobUrls.current.set(key, url);
      return url;
    },
    [client, conn],
  );

  /* ---------------------------------------------------------- downloads */
  const downloadFile = useCallback(
    async (f: DriveFile) => {
      if (!client || !conn) return;
      const id = Math.random().toString(36).slice(2);
      const ac = new AbortController();
      setTransfers((ts) => [
        {
          id,
          kind: "download",
          name: f.name,
          size: f.size,
          loaded: 0,
          state: "running",
          fileRef: f,
          abort: () => ac.abort(),
        },
        ...ts,
      ]);
      try {
        const blob = await downloadBlob(client, conn.channel, f, {
          signal: ac.signal,
          onProgress: (loaded) => patch(id, { loaded }),
        });
        const anyWin = window as any;
        if (anyWin.showSaveFilePicker) {
          // lets the user choose the folder; the OS handles name collisions
          const handle = await anyWin.showSaveFilePicker({ suggestedName: f.name });
          const w = await handle.createWritable();
          await w.write(blob);
          await w.close();
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = f.name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 30_000);
        }
        patch(id, { state: "done", loaded: blob.size, size: blob.size, abort: undefined });
        pushToast("success", `Downloaded “${f.name}”.`);
      } catch (e: any) {
        if (e?.name === "AbortError") {
          patch(id, { state: "cancelled", abort: undefined });
          return;
        }
        const msg = (e as TgError).message ?? "Download failed.";
        patch(id, { state: "error", error: msg, abort: undefined });
        pushToast("error", `Download of “${f.name}” failed: ${msg}`);
      }
    },
    [client, conn, patch, pushToast],
  );

  const downloadMultipleFiles = useCallback(
    async (filesToDownload: DriveFile[]) => {
      if (!client || !conn || filesToDownload.length === 0) return;
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      const now = new Date();
      const folderName = `download_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;

      pushToast("info", "Preparing to download and group files...");

      let hasErrors = false;
      const downloadedBlobs: { name: string; blob: Blob }[] = [];

      for (const f of filesToDownload) {
        const id = Math.random().toString(36).slice(2);
        const ac = new AbortController();
        setTransfers((ts) => [
          {
            id,
            kind: "download",
            name: f.name,
            size: f.size,
            loaded: 0,
            state: "running",
            fileRef: f,
            abort: () => ac.abort(),
          },
          ...ts,
        ]);
        try {
          const blob = await downloadBlob(client, conn.channel, f, {
            signal: ac.signal,
            onProgress: (loaded) => patch(id, { loaded }),
          });

          downloadedBlobs.push({ name: f.name, blob });
          patch(id, { state: "done", loaded: blob.size, size: blob.size, abort: undefined });
        } catch (e: any) {
          hasErrors = true;
          if (e?.name === "AbortError") {
            patch(id, { state: "cancelled", abort: undefined });
            continue;
          }
          const msg = (e as TgError).message ?? "Download failed.";
          patch(id, { state: "error", error: msg, abort: undefined });
          pushToast("error", `Download of “${f.name}” failed: ${msg}`);
        }
      }

      if (downloadedBlobs.length === 0) {
        if (!hasErrors) pushToast("error", "No files downloaded.");
        return;
      }

      pushToast("info", "Compressing files into a ZIP folder...");

      const nameCounts = new Map<string, number>();

      for (const { name, blob } of downloadedBlobs) {
        let uniqueName = name;
        if (nameCounts.has(name.toLowerCase())) {
          const count = nameCounts.get(name.toLowerCase())! + 1;
          nameCounts.set(name.toLowerCase(), count);
          const parts = name.split(".");
          if (parts.length > 1) {
            const ext = parts.pop();
            uniqueName = `${parts.join(".")} (${count}).${ext}`;
          } else {
            uniqueName = `${name} (${count})`;
          }
        } else {
          nameCounts.set(name.toLowerCase(), 1);
        }
        zip.file(uniqueName, blob);
      }

      try {
        const zipBlob = await zip.generateAsync({ type: "blob" });
        const anyWin = window as any;

        if (anyWin.showSaveFilePicker) {
          const handle = await anyWin.showSaveFilePicker({ suggestedName: `${folderName}.zip` });
          const w = await handle.createWritable();
          await w.write(zipBlob);
          await w.close();
        } else {
          const url = URL.createObjectURL(zipBlob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${folderName}.zip`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 30_000);
        }
        pushToast("success", `Successfully downloaded ${folderName}.zip`);
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          pushToast("error", `Failed to save ZIP: ${e.message}`);
        }
      }
    },
    [client, conn, patch, pushToast, downloadFile],
  );

  /* ------------------------------------------------------------- delete */
  const deleteFiles = useCallback(
    async (list: DriveFile[]) => {
      if (!client || !conn) return { ok: 0, failed: 0 };
      try {
        await deleteMessages(
          client,
          conn.channel,
          list.map((f) => f.messageId),
        );
        // removed from the in-memory listing only after Telegram confirmed
        const keys = new Set(list.map((f) => f.key));
        setFiles((prev) => prev.filter((f) => !keys.has(f.key)));
        pushToast("success", `Deleted ${list.length} file${list.length > 1 ? "s" : ""} from Telegram.`);
        return { ok: list.length, failed: 0 };
      } catch (e) {
        pushToast("error", `Deletion failed: ${(e as Error).message}`);
        return { ok: 0, failed: list.length };
      }
    },
    [client, conn, pushToast],
  );

  const value: DriveCtx = {
    settings,
    setSettings,
    dark,
    conn,
    client,
    signedIn,
    disconnect,
    changeChannel,
    connState,
    connError,
    files,
    loading,
    loadingMore,
    hasMore,
    scanned,
    channelTotal,
    lastSync,
    refresh,
    loadMore,
    loadAll,
    transfers,
    queueUploads,
    retryTransfer,
    cancelTransfer,
    clearFinished,
    downloadFile,
    downloadMultipleFiles,
    deleteFiles,
    getMediaUrl,
    getThumbUrl,
    clearTempPreviews,
    toasts,
    pushToast,
    dismissToast,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useDriveMemo = useMemo;
