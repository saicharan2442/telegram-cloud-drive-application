import type { CategoryId } from "./types";

export const CATEGORY_EXT: Record<Exclude<CategoryId, "other">, string[]> = {
  images: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "svg", "tiff", "ico"],
  videos: ["mp4", "mkv", "mov", "avi", "webm", "3gp", "m4v", "mpg", "mpeg", "wmv", "flv"],
  documents: [
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "csv",
    "odt", "ods", "odp", "epub", "md",
  ],
  audio: ["mp3", "wav", "aac", "flac", "ogg", "oga", "m4a", "opus", "wma", "aiff"],
  archives: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz", "iso"],
  apps: ["exe", "msi", "apk", "aab", "dmg", "deb", "rpm", "appimage", "msix"],
  code: [
    "py", "js", "jsx", "ts", "tsx", "html", "htm", "css", "scss", "java", "kt",
    "json", "xml", "yml", "yaml", "cpp", "cc", "c", "h", "hpp", "rs", "go",
    "php", "rb", "sh", "bat", "ps1", "sql", "swift", "dart", "toml", "ini",
  ],
  links: [],
};

const LOOKUP: Record<string, CategoryId> = (() => {
  const m: Record<string, CategoryId> = {};
  for (const [cat, exts] of Object.entries(CATEGORY_EXT)) {
    for (const e of exts) m[e] = cat as CategoryId;
  }
  return m;
})();

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  /** tailwind text color class used sparingly for icons */
  tone: string;
}

export const CATEGORIES: CategoryMeta[] = [
  { id: "images", label: "Images", tone: "text-emerald-500" },
  { id: "videos", label: "Videos", tone: "text-rose-500" },
  { id: "documents", label: "Documents", tone: "text-blue-500" },
  { id: "audio", label: "Audio", tone: "text-amber-500" },
  { id: "archives", label: "Zip files", tone: "text-orange-500" },
  { id: "apps", label: "Applications", tone: "text-violet-500" },
  { id: "code", label: "Code", tone: "text-cyan-500" },
  { id: "links", label: "Links", tone: "text-pink-500" },
  { id: "other", label: "Other", tone: "text-slate-400" },
];

export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const i = base.lastIndexOf(".");
  if (i <= 0 || i === base.length - 1) return "";
  return base.slice(i + 1).toLowerCase();
}

/**
 * Categorisation is purely derived, in memory, from the filename extension.
 * Nothing is persisted. Extensions are lowercased; files without an extension
 * (or with an unknown one) fall back to "other".
 * NOTE: an extension is a hint only — it may not match the real file content.
 */
export function categorize(filename: string, mime?: string): CategoryId {
  const ext = extensionOf(filename);
  if (ext && LOOKUP[ext]) return LOOKUP[ext];
  if (mime) {
    if (mime.startsWith("image/")) return "images";
    if (mime.startsWith("video/")) return "videos";
    if (mime.startsWith("audio/")) return "audio";
    if (mime === "application/pdf") return "documents";
    if (mime.startsWith("text/")) return "documents";
  }
  return "other";
}

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? "Other";
}

export function categoryTone(id: CategoryId): string {
  return CATEGORIES.find((c) => c.id === id)?.tone ?? "text-slate-400";
}
