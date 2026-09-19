import {
  ArrowUpCircle,
  ArrowDownCircle,
  X,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Ban,
} from "lucide-react";
import { useDrive } from "../store/drive";
import { formatBytes, percent } from "../lib/format";

export default function TransfersPanel({ onClose }: { onClose: () => void }) {
  const { transfers, cancelTransfer, retryTransfer, clearFinished } = useDrive();

  return (
    <div className="absolute right-4 top-14 z-40 w-96 overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl anim-in">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h3 className="text-sm font-semibold">Transfers</h3>
        <div className="flex items-center gap-1">
          <button
            className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-ink/5"
            onClick={clearFinished}
          >
            Clear finished
          </button>
          <button className="rounded-lg p-1.5 text-muted hover:bg-ink/5" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {transfers.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">No transfers yet.</p>
        )}
        {transfers.map((t) => {
          const pct = percent(t.loaded, t.size);
          return (
            <div key={t.id} className="border-b border-line/70 px-4 py-2.5 last:border-0">
              <div className="flex items-center gap-2">
                {t.kind === "upload" ? (
                  <ArrowUpCircle size={15} className="shrink-0 text-accent" />
                ) : (
                  <ArrowDownCircle size={15} className="shrink-0 text-emerald-500" />
                )}
                <span className="min-w-0 flex-1 truncate text-[12.5px]" title={t.name}>
                  {t.name}
                </span>
                {t.state === "done" && <CheckCircle2 size={15} className="text-emerald-500" />}
                {t.state === "error" && <AlertTriangle size={15} className="text-rose-500" />}
                {t.state === "cancelled" && <Ban size={15} className="text-muted" />}
                {(t.state === "running" || t.state === "queued") && (
                  <button
                    className="rounded p-1 text-muted hover:bg-ink/5"
                    title="Cancel"
                    onClick={() => cancelTransfer(t.id)}
                  >
                    <X size={14} />
                  </button>
                )}
                {(t.state === "error" || t.state === "cancelled") && t.kind === "upload" && (
                  <button
                    className="rounded p-1 text-muted hover:bg-ink/5"
                    title="Retry"
                    onClick={() => retryTransfer(t.id)}
                  >
                    <RotateCcw size={14} />
                  </button>
                )}
              </div>

              {(t.state === "running" || t.state === "queued") && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/10">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${t.state === "queued" ? 0 : pct}%` }}
                  />
                </div>
              )}
              <div className="mt-1 text-[11px] text-muted">
                {t.state === "queued" && "Queued"}
                {t.state === "running" &&
                  `${formatBytes(t.loaded)}${t.size ? ` / ${formatBytes(t.size)}` : ""} · ${pct}%`}
                {t.state === "done" && `Completed · ${formatBytes(t.size)}`}
                {t.state === "cancelled" && "Cancelled"}
                {t.state === "error" && <span className="text-rose-500">{t.error}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
