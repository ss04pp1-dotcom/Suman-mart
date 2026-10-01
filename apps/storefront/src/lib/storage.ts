import { createHash, randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";

// ─────────────────────────────────────────────────────────────────────────
// Image storage abstraction.
//
// Security model:
//  • SVG is NOT accepted (same-origin SVG upload = stored XSS)
//  • the file type is verified from MAGIC BYTES, never from client headers
//  • every upload is RE-ENCODED with sharp, which strips any embedded
//    payloads (EXIF/XMP thumbnails, appended data, polyglots)
//
// Local implementation writes to /public/uploads (served by Next.js).
// On Cloudflare, swap `saveUpload` internals for an R2 binding:
//
//   const bucket = env.IMAGES_BUCKET;                  // R2 binding
//   await bucket.put(key, file.stream(), { httpMetadata: { contentType } });
//   return `${env.R2_PUBLIC_BASE}/${key}`;             // custom domain URL
//
// The rest of the app only depends on this module's contract.
// ─────────────────────────────────────────────────────────────────────────

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_DIMENSION = 2048; // px — larger images are downscaled on upload
const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");

type SniffedType = "jpeg" | "png" | "webp" | "gif" | null;

/** Detect the real image type from the first bytes of the buffer. */
function sniffMagicBytes(buf: Buffer): SniffedType {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return "png";
  // GIF: "GIF87a" / "GIF89a"
  if (buf.subarray(0, 3).toString("ascii") === "GIF" && ["87a", "89a"].includes(buf.subarray(3, 6).toString("ascii"))) return "gif";
  // WebP: "RIFF" .... "WEBP"
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  // SVG / anything else (including polyglots) → rejected
  return null;
}

const EXT: Record<Exclude<SniffedType, null>, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  gif: "gif",
};

export async function saveUpload(file: File, folder = "misc"): Promise<string> {
  if (file.size > MAX_SIZE) {
    throw new Error("File too large. Maximum size is 5MB.");
  }

  const raw = Buffer.from(await file.arrayBuffer());

  // 1. Magic-byte verification — the client-supplied Content-Type is ignored
  const type = sniffMagicBytes(raw);
  if (!type) {
    throw new Error("Unsupported file. Upload JPG, PNG, WebP or GIF images (SVG is not allowed).");
  }

  // 2. Re-encode through sharp — normalizes the image and strips any
  //    non-image payloads embedded in the original file
  const animated = type === "gif" || type === "webp";
  let encoded: Buffer;
  try {
    const pipeline = sharp(raw, { animated }).rotate(); // honor EXIF orientation
    const meta = await sharp(raw).metadata();
    const needsResize = (meta.width ?? 0) > MAX_DIMENSION || (meta.height ?? 0) > MAX_DIMENSION;
    const sized = needsResize ? pipeline.resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside" }) : pipeline;
    encoded =
      type === "jpeg"
        ? await sized.jpeg({ quality: 85, mozjpeg: true }).toBuffer()
        : type === "png"
          ? await sized.png({ compressionLevel: 8 }).toBuffer()
          : type === "webp"
            ? await sized.webp({ quality: 85 }).toBuffer()
            : await sized.gif().toBuffer();
  } catch {
    throw new Error("The file could not be processed as a valid image.");
  }

  if (encoded.length === 0) {
    throw new Error("The file could not be processed as a valid image.");
  }

  const hash = createHash("sha256").update(encoded).digest("hex").slice(0, 12);
  const key = `${folder}/${hash}-${randomUUID().slice(0, 8)}.${EXT[type]}`;
  const dest = path.join(UPLOAD_ROOT, key);

  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, encoded);

  return `/uploads/${key}`;
}
