export type CategoryId =
  | "images"
  | "videos"
  | "documents"
  | "audio"
  | "archives"
  | "apps"
  | "code"
  | "links"
  | "other";

/** Everything needed to ask Telegram for the bytes of a file. */
export interface FileLocation {
  kind: "document" | "photo";
  id: string;
  accessHash: string;
  fileReference: Uint8Array | number[];
  dcId: number;
  /** photos are addressed by size type, e.g. "x" / "y" */
  sizeType?: string;
  /** small size type used for the grid thumbnail, when the message has one */
  thumbType?: string;
}

/** A file that actually exists as a message in the connected Telegram channel. */
export interface DriveFile {
  key: string;
  messageId: number;
  name: string;
  ext: string;
  category: CategoryId;
  /** bytes — only when Telegram reported it */
  size?: number;
  mime?: string;
  /** unix seconds — Telegram message date */
  date?: number;
  caption?: string;
  loc?: FileLocation;
  /** video/audio duration in seconds, when Telegram provided it */
  duration?: number;
}

export interface ChannelRef {
  id: string;
  accessHash: string;
  title: string;
  username?: string;
  isPrivate: boolean;
  isBroadcast: boolean;
  canDelete: boolean;
  canPost: boolean;
  participants?: number;
}

export interface AccountInfo {
  userId: string;
  firstName?: string;
  username?: string;
  phone?: string;
}

export interface Connection {
  apiId: number;
  apiHash: string;
  account: AccountInfo;
  channel: ChannelRef;
}

export type TransferKind = "upload" | "download";
export type TransferState = "queued" | "running" | "done" | "error" | "cancelled";

export interface Transfer {
  id: string;
  kind: TransferKind;
  name: string;
  size?: number;
  loaded: number;
  state: TransferState;
  error?: string;
  file?: File;
  fileRef?: DriveFile;
  abort?: () => void;
}

export type ViewMode = "grid" | "list";
export type SortKey = "name" | "size" | "date";
export type SortDir = "asc" | "desc";
export type ThemeMode = "light" | "dark" | "system";

export interface Settings {
  theme: ThemeMode;
  view: ViewMode;
  sortKey: SortKey;
  sortDir: SortDir;
}
