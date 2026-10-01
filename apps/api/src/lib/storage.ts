// Image storage — R2 implementation (port of apps/storefront
// src/lib/storage.ts, which wrote to the local filesystem through sharp).
//
// Security model (unchanged core):
//  • SVG is NOT accepted (same-origin SVG upload = stored XSS)
//  • the file type is verified from MAGIC BYTES, never from client headers
//  • hard 5MB size cap
//
// Platform differences, documented honestly:
//  • The Node version re-encoded every upload with sharp (stripping EXIF
//    thumbnails / appended payloads / polyglots and downscaling to 2048px).
//    sharp is a native libjpeg/libvips binding and cannot run inside a
//    Worker; on Workers the magic-byte allowlist (JPEG/PNG/WebP/GIF only)
//    plus the size cap are the active defenses. SVG/HTML/polyglots are
//    rejected exactly as before; embedded metadata is no longer stripped —
//    uploads are served with a fixed Content-Type and
//    Content-Disposition-safe cache headers by the /v1/media route.
//  • Files are stored in the R2 MEDIA bucket under uploads/<folder>/…; the
//    returned public URL (/uploads/<key>) is IDENTICAL to the Node version,
//    so existing DB rows and frontend <img> tags keep working through the
//    storefront/admin media proxies.

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

type SniffedType = "jpeg" | "png" | "webp" | "gif" | null;

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/** Detect the real image type from the first bytes of the buffer. */
function sniffMagicBytes(buf: Uint8Array): SniffedType {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return "png";
  // GIF: "GIF87a" / "GIF89a"
  if (ascii(buf, 0, 3) === "GIF" && ["87a", "89a"].includes(ascii(buf, 3, 6))) return "gif";
  // WebP: "RIFF" .... "WEBP"
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return "webp";
  // SVG / anything else (including polyglots) → rejected
  return null;
}

const EXT: Record<Exclude<SniffedType, null>, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  gif: "gif",
};

const CONTENT_TYPE: Record<Exclude<SniffedType, null>, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

function r2(): R2Bucket {
  const env = (globalThis as unknown as { __apiEnv?: { MEDIA: R2Bucket } }).__apiEnv;
  if (!env?.MEDIA) throw new Error("storage used before the env bridge ran");
  return env.MEDIA;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function saveUpload(file: File, folder = "misc"): Promise<string> {
  if (file.size > MAX_SIZE) {
    throw new Error("File too large. Maximum size is 5MB.");
  }

  const raw = new Uint8Array(await file.arrayBuffer());

  // 1. Magic-byte verification — the client-supplied Content-Type is ignored
  const type = sniffMagicBytes(raw);
  if (!type) {
    throw new Error("Unsupported file. Upload JPG, PNG, WebP or GIF images (SVG is not allowed).");
  }

  // 2. Content-addressed key (dedup-friendly) + short random suffix
  const hash = (await sha256Hex(raw)).slice(0, 12);
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const key = `uploads/${folder}/${hash}-${rand}.${EXT[type]}`;

  await r2().put(key, raw, {
    httpMetadata: {
      contentType: CONTENT_TYPE[type],
      cacheControl: "public, max-age=31536000, immutable",
    },
  });

  // Public URL — same shape as the Node version (served through the
  // storefront/admin /uploads proxy → /v1/media/uploads/…).
  return `/uploads/${key.slice("uploads/".length)}`;
}
