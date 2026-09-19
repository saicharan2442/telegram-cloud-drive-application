import { useEffect, useRef, useState } from "react";
import {
  FileImage,
  FileVideo,
  FileText,
  FileAudio,
  FileArchive,
  AppWindow,
  FileCode2,
  Link as LinkIcon,
  File as FileIconBase,
} from "lucide-react";
import type { CategoryId, DriveFile } from "../lib/types";
import { categoryTone } from "../lib/categories";
import { useDrive } from "../store/drive";

const ICONS: Record<CategoryId, any> = {
  images: FileImage,
  videos: FileVideo,
  documents: FileText,
  audio: FileAudio,
  archives: FileArchive,
  apps: AppWindow,
  code: FileCode2,
  links: LinkIcon,
  other: FileIconBase,
};

export function CategoryIcon({
  category,
  size = 20,
  className = "",
}: {
  category: CategoryId;
  size?: number;
  className?: string;
}) {
  const Icon = ICONS[category] ?? FileIconBase;
  return <Icon size={size} className={`${categoryTone(category)} ${className}`} />;
}

/** Lazily loads a Telegram thumbnail only when the tile scrolls into view. */
export function Thumb({
  file,
  className = "",
  iconSize = 26,
}: {
  file: DriveFile;
  className?: string;
  iconSize?: number;
}) {
  const { getThumbUrl } = useDrive();
  const ref = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const hasThumb = !!file.loc?.thumbType;

  // Thumbnails are only requested when the tile is actually near the viewport,
  // and each one is a few-KB Telegram thumb — never the full file.
  useEffect(() => {
    if (!hasThumb || url || failed) return;
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        io.disconnect();
        getThumbUrl(file)
          .then((u) => !cancelled && (u ? setUrl(u) : setFailed(true)))
          .catch(() => !cancelled && setFailed(true));
      },
      { rootMargin: "150px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [file, hasThumb, url, failed, getThumbUrl]);

  return (
    <div
      ref={ref}
      className={`relative grid place-items-center overflow-hidden ${className}`}
    >
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <CategoryIcon category={file.category} size={iconSize} />
      )}
    </div>
  );
}
