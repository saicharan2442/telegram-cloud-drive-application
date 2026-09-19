import { useMemo } from "react";
import { ExternalLink, Inbox } from "lucide-react";
import type { DriveFile } from "../lib/types";
import { relativeDate } from "../lib/format";

export default function LinksBrowser({
  files,
  emptyHint,
}: {
  files: DriveFile[];
  emptyHint: React.ReactNode;
}) {
  const links = useMemo(() => files.filter((f) => f.category === "links"), [files]);

  if (links.length === 0)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-muted">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-ink/5">
          <Inbox size={24} />
        </div>
        {emptyHint}
      </div>
    );

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="grid grid-cols-[100px_1fr_150px] gap-4 border-b border-line px-5 py-3 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
        <span>Post No.</span>
        <span>Link</span>
        <span>Date</span>
      </div>
      {links.map((link) => (
        <a
          key={link.key}
          href={link.name}
          target="_blank"
          rel="noopener noreferrer"
          className="group grid cursor-pointer grid-cols-[100px_1fr_150px] items-center gap-4 border-b border-line/70 px-5 py-3 text-[13px] last:border-0 hover:bg-ink/[0.035]"
        >
          <span className="font-medium text-muted">#{link.messageId}</span>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-accent group-hover:underline" title={link.name}>
              {link.name}
            </span>
            <ExternalLink size={13} className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <span className="text-muted">{relativeDate(link.date)}</span>
        </a>
      ))}
    </div>
  );
}
