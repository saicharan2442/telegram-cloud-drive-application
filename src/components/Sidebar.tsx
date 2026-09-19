import {
  Cloud,
  Home,
  Files,
  Settings as SettingsIcon,
  Wifi,
  WifiOff,
  AlertTriangle,
} from "lucide-react";
import { CATEGORIES } from "../lib/categories";
import { CategoryIcon } from "./FileVisual";
import { useDrive } from "../store/drive";
import type { CategoryId } from "../lib/types";

export type Route =
  | { page: "home" }
  | { page: "files"; category?: CategoryId }
  | { page: "settings" };

export default function Sidebar({
  route,
  setRoute,
  counts,
  total,
}: {
  route: Route;
  setRoute: (r: Route) => void;
  counts: Record<CategoryId, number>;
  total: number;
}) {
  const { conn, connState } = useDrive();

  const itemCls = (active: boolean) =>
    `flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
      active
        ? "bg-accent/12 font-medium text-accent"
        : "text-ink/75 hover:bg-ink/[0.05]"
    }`;

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-line bg-panel/70">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-md shadow-indigo-500/20">
          <Cloud size={18} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold leading-tight">
            Telegram Cloud Drive
          </div>
          <div className="truncate text-[11px] text-muted">
            {conn?.channel.title ?? "Not connected"}
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-2">
        <button className={itemCls(route.page === "home")} onClick={() => setRoute({ page: "home" })}>
          <Home size={17} /> Home
        </button>
        <button
          className={itemCls(route.page === "files" && !route.category)}
          onClick={() => setRoute({ page: "files" })}
        >
          <Files size={17} /> All Files
          <span className="ml-auto text-xs text-muted">{total || ""}</span>
        </button>

        <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted">
          Categories
        </div>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            className={itemCls(route.page === "files" && route.category === c.id)}
            onClick={() => setRoute({ page: "files", category: c.id })}
          >
            <CategoryIcon category={c.id} size={17} />
            {c.label}
            <span className="ml-auto text-xs text-muted">{counts[c.id] || ""}</span>
          </button>
        ))}
      </nav>

      <div className="space-y-1 border-t border-line p-2.5">
        <button
          className={itemCls(route.page === "settings")}
          onClick={() => setRoute({ page: "settings" })}
        >
          <SettingsIcon size={17} /> Settings
        </button>
        <div className="flex items-center gap-2 px-3 py-1.5 text-[11.5px] text-muted">
          {connState === "online" ? (
            <>
              <Wifi size={13} className="text-emerald-500" />
              {conn
                ? `${conn.account.firstName ?? "Signed in"}${conn.account.username ? ` · @${conn.account.username}` : ""}`
                : "Connected"}
            </>
          ) : connState === "offline" ? (
            <>
              <WifiOff size={13} className="text-rose-500" /> Offline
            </>
          ) : (
            <>
              <AlertTriangle size={13} className="text-amber-500" /> Connection problem
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
