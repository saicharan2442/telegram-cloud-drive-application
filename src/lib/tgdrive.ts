/**
 * Channel + file operations on top of the MTProto client.
 * Everything here is stateless: results are handed to React and kept in memory.
 */
import { TgClient, TgError } from "./mtproto";
import { categorize, extensionOf } from "./categories";
import type { ChannelRef, DriveFile, FileLocation } from "./types";

export const MAX_UPLOAD = 2 * 1024 * 1024 * 1024; // 2 GB (512 KB × 4000 parts)
const PART_SIZE = 512 * 1024;
const DOWNLOAD_CHUNK = 512 * 1024;

/* ------------------------------------------------------------------ peers */

export const inputPeer = (c: ChannelRef) => ({
  _: "inputPeerChannel",
  channel_id: c.id,
  access_hash: c.accessHash,
});

export const inputChannel = (c: ChannelRef) => ({
  _: "inputChannel",
  channel_id: c.id,
  access_hash: c.accessHash,
});

function toChannelRef(chat: any): ChannelRef {
  const rights = chat.admin_rights ?? {};
  return {
    id: String(chat.id),
    accessHash: String(chat.access_hash ?? "0"),
    title: chat.title ?? String(chat.id),
    username: chat.username,
    isPrivate: !chat.username,
    isBroadcast: !!chat.broadcast,
    canDelete: !!chat.creator || !!rights.delete_messages,
    canPost: !!chat.creator || !!rights.post_messages || !!chat.megagroup,
    participants: chat.participants_count,
  };
}

/** Your channels and supergroups, straight from messages.getDialogs. */
export async function listChannels(client: TgClient): Promise<ChannelRef[]> {
  const res = await client.call<any>("messages.getDialogs", {
    offset_date: 0,
    offset_id: 0,
    offset_peer: { _: "inputPeerEmpty" },
    limit: 100,
    hash: 0,
  });
  const chats: any[] = res?.chats ?? [];
  return chats
    .filter((c) => c._ === "channel" && !c.left && c.access_hash)
    .map(toChannelRef);
}

/** Resolve @username or verify a channel we already know. */
export async function resolveChannel(
  client: TgClient,
  username: string,
): Promise<ChannelRef> {
  const res = await client.call<any>("contacts.resolveUsername", {
    username: username.replace(/^@/, ""),
  });
  const chat = (res?.chats ?? []).find((c: any) => c._ === "channel");
  if (!chat) throw new TgError("That username is not a channel.", 0);
  return toChannelRef(chat);
}

export async function verifyChannel(
  client: TgClient,
  ref: ChannelRef,
): Promise<ChannelRef> {
  const res = await client.call<any>("channels.getChannels", {
    id: [inputChannel(ref)],
  });
  const chat = (res?.chats ?? [])[0];
  if (!chat || chat._ !== "channel")
    throw new TgError("The channel is no longer accessible with this account.", 0);
  return toChannelRef(chat);
}

/* --------------------------------------------------------------- metadata */

const num = (v: any): number | undefined => {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : undefined;
};

function pickThumbType(thumbs: any[] | undefined): string | undefined {
  if (!thumbs?.length) return undefined;
  const real = thumbs.filter((t) => t._ === "photoSize" || t._ === "photoSizeProgressive");
  if (!real.length) return undefined;
  // smallest real size = cheapest thumbnail
  real.sort((a, b) => (a.w ?? 0) - (b.w ?? 0));
  return real[0].type;
}

function pickLargest(sizes: any[] | undefined): { type: string; size?: number } | null {
  if (!sizes?.length) return null;
  const real = sizes.filter((s) => s._ === "photoSize" || s._ === "photoSizeProgressive");
  if (!real.length) return null;
  real.sort((a, b) => (a.w ?? 0) - (b.w ?? 0));
  const big = real[real.length - 1];
  const size = big._ === "photoSizeProgressive" ? big.sizes?.[big.sizes.length - 1] : big.size;
  return { type: big.type, size: num(size) };
}

/** Telegram message -> DriveFile. Returns null for messages without a file. */
export function mapMessage(msg: any): DriveFile | null {
  if (!msg || msg._ !== "message" || !msg.media) return null;
  const messageId: number = msg.id;
  const date: number | undefined = msg.date;
  const caption: string | undefined = msg.message || undefined;

  if (msg.media._ === "messageMediaDocument" && msg.media.document?._ === "document") {
    const d = msg.media.document;
    const attrs: any[] = d.attributes ?? [];
    const nameAttr = attrs.find((a) => a._ === "documentAttributeFilename");
    const videoAttr = attrs.find((a) => a._ === "documentAttributeVideo");
    const audioAttr = attrs.find((a) => a._ === "documentAttributeAudio");
    const name: string =
      nameAttr?.file_name ||
      (audioAttr?.title ? `${audioAttr.title}.mp3` : "") ||
      (videoAttr ? `video_${messageId}.mp4` : "") ||
      `file_${messageId}`;
    const loc: FileLocation = {
      kind: "document",
      id: String(d.id),
      accessHash: String(d.access_hash),
      fileReference: d.file_reference,
      dcId: d.dc_id,
      thumbType: pickThumbType(d.thumbs),
    };
    return {
      key: `m${messageId}`,
      messageId,
      name,
      ext: extensionOf(name),
      category: categorize(name, d.mime_type),
      size: num(d.size),
      mime: d.mime_type,
      date,
      caption,
      loc,
      duration: videoAttr?.duration ?? audioAttr?.duration,
    };
  }

  if (msg.media._ === "messageMediaPhoto" && msg.media.photo?._ === "photo") {
    const p = msg.media.photo;
    const largest = pickLargest(p.sizes);
    if (!largest) return null;
    const name = `photo_${messageId}.jpg`;
    const loc: FileLocation = {
      kind: "photo",
      id: String(p.id),
      accessHash: String(p.access_hash),
      fileReference: p.file_reference,
      dcId: p.dc_id,
      sizeType: largest.type,
      thumbType: pickThumbType(p.sizes) ?? largest.type,
    };
    return {
      key: `m${messageId}`,
      messageId,
      name,
      ext: "jpg",
      category: "images",
      size: largest.size,
      mime: "image/jpeg",
      date,
      caption,
      loc,
    };
  }

  return null;
}

/* ------------------------------------------------------------ history page */

export interface HistoryPage {
  files: DriveFile[];
  /** number of raw messages scanned in this page */
  scanned: number;
  /** offset_id to pass next time; null when the channel start was reached */
  nextOffsetId: number | null;
  /** total messages in the channel, when Telegram reports it */
  total?: number;
}

/**
 * One page of real channel history (newest first). This is the capability a
 * bot simply does not have.
 */
export async function loadHistoryPage(
  client: TgClient,
  channel: ChannelRef,
  offsetId: number,
  limit = 60,
): Promise<HistoryPage> {
  const res = await client.call<any>("messages.getHistory", {
    peer: inputPeer(channel),
    offset_id: offsetId,
    offset_date: 0,
    add_offset: 0,
    limit,
    max_id: 0,
    min_id: 0,
    hash: 0,
  });
  const messages: any[] = res?.messages ?? [];
  const files = messages.map(mapMessage).filter(Boolean) as DriveFile[];
  const last = messages[messages.length - 1];
  return {
    files,
    scanned: messages.length,
    nextOffsetId: messages.length < limit || !last ? null : last.id,
    total: num(res?.count),
  };
}

/* ------------------------------------------------------------- file bytes */

function inputLocation(loc: FileLocation) {
  return loc.kind === "document"
    ? {
        _: "inputDocumentFileLocation",
        id: loc.id,
        access_hash: loc.accessHash,
        file_reference: loc.fileReference,
        thumb_size: "",
      }
    : {
        _: "inputPhotoFileLocation",
        id: loc.id,
        access_hash: loc.accessHash,
        file_reference: loc.fileReference,
        thumb_size: loc.sizeType ?? "x",
      };
}

function thumbLocation(loc: FileLocation, type: string) {
  return loc.kind === "document"
    ? {
        _: "inputDocumentFileLocation",
        id: loc.id,
        access_hash: loc.accessHash,
        file_reference: loc.fileReference,
        thumb_size: type,
      }
    : {
        _: "inputPhotoFileLocation",
        id: loc.id,
        access_hash: loc.accessHash,
        file_reference: loc.fileReference,
        thumb_size: type,
      };
}

/** Re-fetch a message so we get a fresh file_reference (they expire). */
export async function refreshFile(
  client: TgClient,
  channel: ChannelRef,
  messageId: number,
): Promise<DriveFile | null> {
  const res = await client.call<any>("channels.getMessages", {
    channel: inputChannel(channel),
    id: [{ _: "inputMessageID", id: messageId }],
  });
  const msg = (res?.messages ?? [])[0];
  return mapMessage(msg);
}

export interface DownloadOpts {
  onProgress?: (loaded: number, total?: number) => void;
  signal?: AbortSignal;
  /** cap for previews so we never pull a 2 GB video just to show it */
  maxBytes?: number;
}

/** Chunked download straight from the file's data centre. */
export async function downloadBlob(
  client: TgClient,
  channel: ChannelRef,
  file: DriveFile,
  opts: DownloadOpts = {},
): Promise<Blob> {
  let loc = file.loc;
  const parts: Uint8Array[] = [];
  let offset = 0;
  let refreshed = false;

  for (;;) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (opts.maxBytes && offset >= opts.maxBytes) break;

    let res: any;
    try {
      res = await client.call(
        "upload.getFile",
        { location: inputLocation(loc), offset, limit: DOWNLOAD_CHUNK, precise: false },
        { dcId: loc.dcId },
      );
    } catch (e: any) {
      // file_reference values expire; fetch the message again and continue once
      if (!refreshed && String(e?.message ?? "").includes("file reference")) {
        refreshed = true;
        const fresh = await refreshFile(client, channel, file.messageId);
        if (!fresh) throw e;
        loc = fresh.loc;
        continue;
      }
      throw e;
    }

    if (res._ === "upload.fileCdnRedirect")
      throw new TgError(
        "Telegram served this file from a CDN node, which this build does not implement. Open it in the Telegram app.",
        0,
      );

    const bytes: Uint8Array = res.bytes;
    if (bytes?.length) {
      parts.push(bytes);
      offset += bytes.length;
      opts.onProgress?.(offset, file.size);
    }
    if (!bytes || bytes.length < DOWNLOAD_CHUNK) break;
    if (file.size && offset >= file.size) break;
  }

  return new Blob(parts as BlobPart[], { type: file.mime || "application/octet-stream" });
}

/** Small thumbnail bytes (a few KB) for grid tiles. */
export async function downloadThumb(
  client: TgClient,
  file: DriveFile,
): Promise<Blob | null> {
  const type = file.loc.thumbType;
  if (!type) return null;
  const res: any = await client.call(
    "upload.getFile",
    { location: thumbLocation(file.loc, type), offset: 0, limit: 256 * 1024 },
    { dcId: file.loc.dcId },
  );
  if (res._ !== "upload.file" || !res.bytes?.length) return null;
  return new Blob([res.bytes as BlobPart], { type: "image/jpeg" });
}

/* ----------------------------------------------------------------- upload */

function randomLong(): string {
  const b = new Uint32Array(2);
  crypto.getRandomValues(b);
  return String((BigInt(b[0]) << 32n) | BigInt(b[1]));
}

export interface UploadOpts {
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Real chunked upload: 512 KB parts -> upload.saveBigFilePart /
 * upload.saveFilePart -> messages.sendMedia. Never split across messages.
 */
export async function uploadFile(
  client: TgClient,
  channel: ChannelRef,
  file: File,
  opts: UploadOpts = {},
): Promise<DriveFile | null> {
  if (file.size > MAX_UPLOAD)
    throw new TgError(
      `“${file.name}” is larger than the 2 GB per-file limit of the Telegram client API.`,
      0,
    );
  if (file.size === 0) throw new TgError("Empty files cannot be uploaded to Telegram.", 0);

  const fileId = randomLong();
  const totalParts = Math.ceil(file.size / PART_SIZE);
  const isBig = file.size > 10 * 1024 * 1024;
  let uploaded = 0;

  for (let part = 0; part < totalParts; part++) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const slice = file.slice(part * PART_SIZE, Math.min((part + 1) * PART_SIZE, file.size));
    const bytes = new Uint8Array(await slice.arrayBuffer());
    await client.call(isBig ? "upload.saveBigFilePart" : "upload.saveFilePart", {
      file_id: fileId,
      file_part: part,
      file_total_parts: totalParts,
      bytes,
    });
    uploaded += bytes.length;
    opts.onProgress?.(uploaded, file.size);
  }

  const inputFile = isBig
    ? { _: "inputFileBig", id: fileId, parts: totalParts, name: file.name }
    : { _: "inputFile", id: fileId, parts: totalParts, name: file.name, md5_checksum: "" };

  const updates: any = await client.call("messages.sendMedia", {
    peer: inputPeer(channel),
    media: {
      _: "inputMediaUploadedDocument",
      force_file: true,
      file: inputFile,
      mime_type: file.type || "application/octet-stream",
      attributes: [{ _: "documentAttributeFilename", file_name: file.name }],
    },
    message: "",
    random_id: randomLong(),
  });

  const created = (updates?.updates ?? []).find(
    (u: any) => u._ === "updateNewChannelMessage" || u._ === "updateNewMessage",
  );
  return created ? mapMessage(created.message) : null;
}

/* ----------------------------------------------------------------- delete */

/** Returns true only when Telegram confirmed the deletion. */
export async function deleteMessages(
  client: TgClient,
  channel: ChannelRef,
  ids: number[],
): Promise<number> {
  const res: any = await client.call("channels.deleteMessages", {
    channel: inputChannel(channel),
    id: ids,
  });
  return typeof res?.pts_count === "number" ? res.pts_count : ids.length;
}
