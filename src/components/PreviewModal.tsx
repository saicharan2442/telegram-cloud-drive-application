import { useEffect, useState } from "react";
import {
  X,
  Download,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Loader2,
  AlertTriangle,
  Play,
} from "lucide-react";
import type { DriveFile } from "../lib/types";
import { useDrive } from "../store/drive";
import { formatBytes, formatDate, percent } from "../lib/format";
import { CategoryIcon } from "./FileVisual";

/** Above this we ask before pulling the bytes just to preview them. */
const AUTO_PREVIEW_LIMIT = 25 * 1024 * 1024;

export default function PreviewModal({
  file,
  siblings,
  onClose,
  onNavigate,
}: {
  file: DriveFile;
  siblings: DriveFile[];
  onClose: () => void;
  onNavigate: (f: DriveFile) => void;
}) {
  const { getMediaUrl, downloadFile } = useDrive();
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [loaded, setLoaded] = useState(0);
  const [confirmed, setConfirmed] = useState(false);

  const ext = file.ext;
  const isImage = file.category === "images" && ext !== "svg";
  const isVideo = file.category === "videos";
  const isAudio = file.category === "audio";
  const isPdf = ext === "pdf";
  const isText = ["txt", "md", "csv", "json", "xml", "log"].includes(ext);
  const previewable = isImage || isVideo || isAudio || isPdf || isText;
  const big = (file.size ?? 0) > AUTO_PREVIEW_LIMIT;
  const shouldFetch = previewable && (!big || confirmed);

  const index = siblings.findIndex((f) => f.key === file.key);

  useEffect(() => {
    setUrl(null);
    setErr(null);
    setZoom(1);
    setLoaded(0);
    setConfirmed(false);
  }, [file.key]);

  useEffect(() => {
    if (!shouldFetch || url) return;
    let alive = true;
    getMediaUrl(file, (n) => alive && setLoaded(n))
      .then((u) => alive && setUrl(u))
      .catch((e) => alive && setErr(e?.message ?? "Preview unavailable."));
    return () => {
      alive = false;
    };
  }, [shouldFetch, url, file, getMediaUrl]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < siblings.length - 1) onNavigate(siblings[index + 1]);
      if (e.key === "ArrowLeft" && index > 0) onNavigate(siblings[index - 1]);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [index, siblings, onClose, onNavigate]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/75 backdrop-blur-sm">
      <div className="flex items-center gap-3 px-4 py-3 text-white">
        <CategoryIcon category={file.category} size={18} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{file.name}</div>
          <div className="truncate text-[11.5px] text-white/60">
            {formatBytes(file.size)} · {formatDate(file.date)} · message #{file.messageId}
          </div>
        </div>
        {isImage && url && (
          <div className="flex items-center gap-1">
            <button className="rounded-lg p-2 hover:bg-white/10" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>
              <ZoomOut size={17} />
            </button>
            <span className="w-12 text-center text-xs">{Math.round(zoom * 100)}%</span>
            <button className="rounded-lg p-2 hover:bg-white/10" onClick={() => setZoom((z) => Math.min(5, z + 0.25))}>
              <ZoomIn size={17} />
            </button>
            <button className="rounded-lg p-2 hover:bg-white/10" onClick={() => setZoom(1)} title="Fit to window">
              <Maximize2 size={17} />
            </button>
          </div>
        )}
        <button
          className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
          onClick={() => void downloadFile(file)}
        >
          <Download size={16} /> Download
        </button>
        <button className="rounded-lg p-2 hover:bg-white/10" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-auto p-6">
        {index > 0 && (
          <button
            className="absolute left-3 z-10 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20"
            onClick={() => onNavigate(siblings[index - 1])}
          >
            <ChevronLeft size={20} />
          </button>
        )}
        {index < siblings.length - 1 && (
          <button
            className="absolute right-3 z-10 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20"
            onClick={() => onNavigate(siblings[index + 1])}
          >
            <ChevronRight size={20} />
          </button>
        )}

        {!previewable ? (
          <Card>
            <CategoryIcon category={file.category} size={34} className="mx-auto" />
            <h3 className="mt-3 truncate text-sm font-semibold">{file.name}</h3>
            <p className="mt-2 text-sm text-muted">
              No in-app viewer exists for <b>.{ext || "this type"}</b>. Download it and open it
              with a local application.
            </p>
            <button
              className="mt-4 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white"
              onClick={() => void downloadFile(file)}
            >
              Download
            </button>
          </Card>
        ) : big && !confirmed ? (
          <Card>
            <Play size={30} className="mx-auto text-accent" />
            <h3 className="mt-3 text-sm font-semibold">Fetch {formatBytes(file.size)} to preview?</h3>
            <p className="mt-2 text-sm text-muted">
              Telegram media has no public URL, so previewing means downloading the file into a
              temporary in-memory buffer first. There is no streaming — this build is honest
              about that. The buffer is released when you clear previews or disconnect.
            </p>
            <button
              className="mt-4 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white"
              onClick={() => setConfirmed(true)}
            >
              Load preview
            </button>
          </Card>
        ) : err ? (
          <Card>
            <AlertTriangle size={22} className="mx-auto text-amber-500" />
            <p className="mt-3 text-sm">{err}</p>
          </Card>
        ) : !url ? (
          <div className="w-64 text-center text-white/80">
            <Loader2 className="mx-auto animate-spin" size={22} />
            <p className="mt-3 text-sm">Fetching from Telegram…</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-white transition-all"
                style={{ width: `${percent(loaded, file.size)}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-white/60">
              {formatBytes(loaded)} {file.size ? `/ ${formatBytes(file.size)}` : ""}
            </p>
          </div>
        ) : isImage ? (
          <img
            src={url}
            alt={file.name}
            style={{ transform: `scale(${zoom})` }}
            className="max-h-full max-w-full origin-center object-contain transition-transform"
          />
        ) : isVideo ? (
          <video src={url} controls autoPlay className="max-h-full max-w-full rounded-xl" />
        ) : isAudio ? (
          <div className="w-full max-w-md rounded-2xl bg-panel p-6">
            <div className="truncate text-sm font-medium">{file.name}</div>
            {file.duration && (
              <div className="mt-1 text-[12px] text-muted">
                Duration {Math.floor(file.duration / 60)}:
                {String(file.duration % 60).padStart(2, "0")}
              </div>
            )}
            <audio src={url} controls autoPlay className="mt-4 w-full" />
          </div>
        ) : (
          <iframe src={url} title={file.name} className="h-full w-full rounded-xl bg-white" />
        )}
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="max-w-md rounded-2xl bg-panel p-6 text-center">{children}</div>;
}
