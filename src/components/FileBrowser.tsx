import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Trash2, Eye, Loader2, Inbox } from "lucide-react";
import type { DriveFile } from "../lib/types";
import { formatBytes, relativeDate } from "../lib/format";
import { CategoryIcon, Thumb } from "./FileVisual";
import { categoryLabel } from "../lib/categories";

const PAGE = 48;

export default function FileBrowser({
  files,
  view,
  selected,
  canDelete,
  onSelect,
  onSelectMany,
  onOpen,
  onDownload,
  onDelete,
  loading,
  emptyHint,
}: {
  files: DriveFile[];
  view: "grid" | "list";
  selected: Set<string>;
  canDelete: boolean;
  onSelect: (key: string, mode: "single" | "toggle" | "range") => void;
  onSelectMany?: (keys: string[], replace: boolean, base?: Set<string>) => void;
  onOpen: (f: DriveFile) => void;
  onDownload: (f: DriveFile) => void;
  onDelete: (f: DriveFile) => void;
  loading: boolean;
  emptyHint: React.ReactNode;
}) {
  const [limit, setLimit] = useState(PAGE);
  const [menu, setMenu] = useState<{ x: number; y: number; file: DriveFile } | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Lasso state
  const [lasso, setLasso] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const [lassoSelected, setLassoSelected] = useState<Set<string>>(new Set());
  const [lassoBase, setLassoBase] = useState<Set<string> | null>(null);
  const isDragging = useRef(false);
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => setLimit(PAGE), [files.length === 0, view]);

  // incremental rendering: only mount more rows when the sentinel is visible
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting) setLimit((l) => (l < files.length ? l + PAGE : l));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [files.length]);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
    };
  }, []);

  const shown = useMemo(() => files.slice(0, limit), [files, limit]);

  function clickHandler(e: React.MouseEvent, f: DriveFile) {
    if (isDragging.current) return;
    onSelect(f.key, e.ctrlKey || e.metaKey ? "toggle" : e.shiftKey ? "range" : "single");
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("[data-file-key]")) return;
    const rect = containerRef.current!.getBoundingClientRect();
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
    isDragging.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointerDownPos.current || !containerRef.current) return;

    const dx = e.clientX - pointerDownPos.current.x;
    const dy = e.clientY - pointerDownPos.current.y;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Threshold to start dragging
    if (!lasso && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      isDragging.current = true;
      const startX = pointerDownPos.current.x - rect.left;
      const startY = pointerDownPos.current.y - rect.top;
      setLasso({
        startX,
        startY,
        currentX: x,
        currentY: y,
      });
      setLassoBase(new Set(e.ctrlKey || e.metaKey || e.shiftKey ? selected : []));
    }

    if (lasso) {
      setLasso({ ...lasso, currentX: x, currentY: y });

      const rx = Math.min(lasso.startX, x);
      const ry = Math.min(lasso.startY, y);
      const rw = Math.abs(x - lasso.startX);
      const rh = Math.abs(y - lasso.startY);

      const items = containerRef.current.querySelectorAll("[data-file-key]");
      const newSel = new Set<string>();
      items.forEach((item) => {
        const itemRect = item.getBoundingClientRect();
        const itemLeft = itemRect.left - rect.left;
        const itemRight = itemRect.right - rect.left;
        const itemTop = itemRect.top - rect.top;
        const itemBottom = itemRect.bottom - rect.top;

        if (itemLeft < rx + rw && itemRight > rx && itemTop < ry + rh && itemBottom > ry) {
          const key = item.getAttribute("data-file-key");
          if (key) newSel.add(key);
        }
      });
      setLassoSelected(newSel);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointerDownPos.current = null;
    if (lasso) {
      if (onSelectMany && lassoBase) {
        onSelectMany(Array.from(lassoSelected), !(e.ctrlKey || e.metaKey || e.shiftKey), lassoBase);
      }
      setLasso(null);
      setLassoBase(null);
      setLassoSelected(new Set());
      e.currentTarget.releasePointerCapture(e.pointerId);
      // reset isDragging shortly after to prevent click
      setTimeout(() => (isDragging.current = false), 50);
    } else {
      isDragging.current = false;
    }
  };

  const isSelected = (key: string) => {
    if (lasso && lassoBase) {
      // During drag, visual selection combines base + lassoSelected
      return lassoBase.has(key) || lassoSelected.has(key);
    }
    return selected.has(key);
  };

  if (loading && files.length === 0)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
        <Loader2 className="animate-spin" size={26} />
        <p className="text-sm">Retrieving file metadata from Telegram…</p>
      </div>
    );

  if (files.length === 0)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-muted">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-ink/5">
          <Inbox size={24} />
        </div>
        {emptyHint}
      </div>
    );

  return (
    <div
      ref={containerRef}
      className="relative touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {view === "grid" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3.5">
          {shown.map((f) => {
            const sel = isSelected(f.key);
            return (
              <div
                key={f.key}
                data-file-key={f.key}
                onClick={(e) => clickHandler(e, f)}
                onDoubleClick={() => onOpen(f)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!selected.has(f.key)) onSelect(f.key, "single");
                  setMenu({ x: e.clientX, y: e.clientY, file: f });
                }}
                className={`group cursor-default overflow-hidden rounded-2xl border bg-panel transition ${
                  sel
                    ? "border-accent ring-2 ring-accent/25"
                    : "border-line hover:border-accent/40 hover:shadow-sm"
                }`}
              >
                <Thumb
                  file={f}
                  iconSize={30}
                  className="h-28 w-full bg-ink/[0.035]"
                />
                <div className="space-y-1 p-2.5">
                  <div className="flex items-center gap-1.5">
                    <CategoryIcon category={f.category} size={13} />
                    <div className="truncate text-[12.5px] font-medium" title={f.name}>
                      {f.name}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted">
                    <span>{formatBytes(f.size)}</span>
                    <span>{relativeDate(f.date)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-panel">
          <div className="grid grid-cols-[1fr_110px_110px_150px] gap-3 border-b border-line px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
            <span>Name</span>
            <span>Category</span>
            <span>Size</span>
            <span>Date</span>
          </div>
          {shown.map((f) => {
            const sel = isSelected(f.key);
            return (
              <div
                key={f.key}
                data-file-key={f.key}
                onClick={(e) => clickHandler(e, f)}
                onDoubleClick={() => onOpen(f)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!selected.has(f.key)) onSelect(f.key, "single");
                  setMenu({ x: e.clientX, y: e.clientY, file: f });
                }}
                className={`grid cursor-default grid-cols-[1fr_110px_110px_150px] items-center gap-3 border-b border-line/70 px-4 py-2 text-[13px] last:border-0 ${
                  sel ? "bg-accent/10" : "hover:bg-ink/[0.035]"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Thumb file={f} iconSize={16} className="h-7 w-7 shrink-0 rounded-md bg-ink/[0.05]" />
                  <span className="truncate" title={f.name}>
                    {f.name}
                  </span>
                </div>
                <span className="text-muted">{categoryLabel(f.category)}</span>
                <span className="text-muted">{formatBytes(f.size)}</span>
                <span className="text-muted">{relativeDate(f.date)}</span>
              </div>
            );
          })}
        </div>
      )}

      {limit < files.length && (
        <div ref={sentinel} className="py-6 text-center text-xs text-muted">
          Showing {limit} of {files.length} loaded files…
        </div>
      )}

      {menu && (
        <div
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-48 overflow-hidden rounded-xl border border-line bg-panel py-1 text-sm shadow-xl anim-in"
        >
          <button
            className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-ink/5"
            onClick={() => {
              onOpen(menu.file);
              setMenu(null);
            }}
          >
            <Eye size={15} /> Preview
          </button>
          <button
            className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-ink/5"
            onClick={() => {
              onDownload(menu.file);
              setMenu(null);
            }}
          >
            <Download size={15} /> Download
          </button>
          {canDelete && (
            <button
              className="flex w-full items-center gap-2.5 px-3 py-2 text-rose-500 hover:bg-rose-500/10"
              onClick={() => {
                onDelete(menu.file);
                setMenu(null);
              }}
            >
              <Trash2 size={15} /> Delete from Telegram
            </button>
          )}
        </div>
      )}

      {lasso && (
        <div
          className="absolute pointer-events-none z-50 border border-accent bg-accent/20"
          style={{
            left: Math.min(lasso.startX, lasso.currentX),
            top: Math.min(lasso.startY, lasso.currentY),
            width: Math.abs(lasso.currentX - lasso.startX),
            height: Math.abs(lasso.currentY - lasso.startY),
          }}
        />
      )}
    </div>
  );
}
