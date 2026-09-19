import { Download, Trash2, Eye, X, Hash } from "lucide-react";
import type { DriveFile } from "../lib/types";
import { formatBytes, formatDate } from "../lib/format";
import { categoryLabel } from "../lib/categories";
import { CategoryIcon, Thumb } from "./FileVisual";
import { useDrive } from "../store/drive";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-[12.5px]">
      <span className="text-muted">{k}</span>
      <span className="max-w-[60%] break-words text-right">{v}</span>
    </div>
  );
}

export default function DetailsPanel({
  file,
  selectedFiles,
  count,
  onClose,
  onPreview,
  onDelete,
}: {
  file: DriveFile;
  selectedFiles: DriveFile[];
  count: number;
  onClose: () => void;
  onPreview: () => void;
  onDelete: () => void;
}) {
  const { downloadFile, downloadMultipleFiles, conn } = useDrive();

  const handleDownload = async () => {
    if (selectedFiles.length > 1) {
      await downloadMultipleFiles(selectedFiles);
    } else {
      for (const f of selectedFiles) {
        await downloadFile(f);
      }
    }
  };

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-l border-line bg-panel/70">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-semibold">
          {count > 1 ? `${count} files selected` : "File details"}
        </h3>
        <button className="rounded-lg p-1.5 text-muted hover:bg-ink/5" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <Thumb
          file={file}
          iconSize={40}
          className="h-36 w-full rounded-xl border border-line bg-ink/[0.035]"
        />
        <div className="mt-3 flex items-start gap-2">
          <CategoryIcon category={file.category} size={16} className="mt-0.5" />
          <div className="break-words text-[13px] font-medium">{file.name}</div>
        </div>

        <div className="mt-3 divide-y divide-line/70 border-t border-line/70">
          <Row k="Category" v={categoryLabel(file.category)} />
          <Row k="Extension" v={file.ext ? `.${file.ext}` : "none"} />
          <Row k="Size" v={formatBytes(file.size)} />
          <Row k="Telegram date" v={formatDate(file.date)} />
          <Row k="MIME type" v={file.mime ?? "—"} />
          <Row
            k="Message"
            v={
              <span className="inline-flex items-center gap-1">
                <Hash size={11} />
                {file.messageId}
              </span>
            }
          />
          <Row k="Channel" v={conn?.channel.title ?? "—"} />
          {file.caption && <Row k="Caption" v={file.caption} />}
        </div>

        <div className="mt-4 space-y-2">
          <button
            onClick={onPreview}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-line py-2 text-sm font-medium hover:bg-ink/5"
          >
            <Eye size={15} /> Preview
          </button>
          <button
            onClick={handleDownload}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <Download size={15} /> Download{count > 1 ? ` ${count} files` : ""}
          </button>
          {conn?.channel.canDelete && (
            <button
              onClick={onDelete}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/30 py-2 text-sm font-medium text-rose-500 hover:bg-rose-500/10"
            >
              <Trash2 size={15} /> Delete{count > 1 ? ` ${count} files` : ""}
            </button>
          )}
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          Only metadata reported by Telegram is shown. Empty values mean Telegram did not
          provide that field.
        </p>
      </div>
    </aside>
  );
}
