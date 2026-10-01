/**
 * FIX 1 — Product image data bug.
 *
 * Root cause: scripts/image-manifest.json is keyed by short image-prefix names
 * (e.g. "wireless-earbuds"), but prisma/seed.ts looks up images by the full
 * product slug (e.g. "wireless-earbuds-pro"). Only 1 of 37 products matched,
 * leaving 36 products with zero images (storefront showed placeholder icons).
 *
 * This script:
 *   1. Rewrites the manifest so product keys === product slugs (fresh seeds work).
 *   2. Backfills ProductImage rows in the LIVE database for any product that
 *      currently has zero images (no destructive resets — orders, tracking and
 *      reviews stay intact).
 *   3. Reports per-product image counts afterwards.
 *
 * Run: bun run scripts/fix-product-images.ts
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/home/z/my-project";
const MANIFEST_PATH = join(ROOT, "scripts/image-manifest.json");
const PUBLIC = join(ROOT, "public");

// product slug (as defined in prisma/seed.ts defs) → old manifest key (file prefix)
const SLUG_TO_OLD_KEY: Record<string, string> = {
  "wireless-earbuds-pro": "wireless-earbuds",
  "smart-watch-series-x": "smart-watch",
  "portable-bluetooth-speaker": "bluetooth-speaker",
  "gan-fast-charger-65w": "fast-charger",
  "power-bank-20000mah": "power-bank",
  "mechanical-keyboard-rgb": "mechanical-keyboard",
  "wireless-silent-mouse": "wireless-mouse",
  "usb-c-hub-7in1": "usb-c-hub",
  "swiftrun-running-sneakers": "running-sneakers",
  "classic-denim-jacket": "denim-jacket",
  "premium-cotton-tee": "cotton-tshirt",
  "leather-crossbody-bag": "crossbody-bag",
  "polarized-sunglasses": "polarized-sunglasses",
  "heritage-analog-watch": "analog-watch",
  "ceramic-mug-set-4": "ceramic-mugs",
  "vanilla-scented-candle": "scented-candle",
  "nordic-table-lamp": "table-lamp",
  "throw-pillow-covers-2": "throw-pillows",
  "foldable-storage-organizer": "storage-organizer",
  "vitamin-c-serum-20": "vitamin-c-serum",
  "gentle-facial-cleanser": "facial-cleanser",
  "matte-lipstick-set-5": "lipstick-set",
  "ionic-hair-dryer-2000w": "hair-dryer",
  "eco-yoga-mat-8mm": "yoga-mat",
  "adjustable-dumbbell-pair": "dumbbell-set",
  "speed-jump-rope": "jump-rope",
  "insulated-steel-bottle-1l": "steel-water-bottle",
  "armor-phone-case": "phone-case",
  "voyager-laptop-backpack-25l": "laptop-backpack",
  "genuine-leather-wallet": "leather-wallet",
  "magnetic-car-phone-mount": "car-phone-mount",
  "creative-building-blocks-500": "building-blocks",
  "rc-rally-car-2-4ghz": "rc-car",
  "cuddly-plush-bear-40cm": "plush-bear",
  "sundarban-organic-honey-500g": "organic-honey",
  "premium-green-tea-250g": "green-tea",
  "premium-kimia-dates-1kg": "premium-dates",
};

const manifest: Record<string, string[]> = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

// ── Step 1: re-key the manifest (slug → urls). Keep non-product keys (banners/categories). ──
const remapped: Record<string, string[]> = {};
const keyMap = new Map<string, string>(); // slug → urls
for (const [oldKey, urls] of Object.entries(manifest)) {
  const slug = Object.keys(SLUG_TO_OLD_KEY).find((s) => SLUG_TO_OLD_KEY[s] === oldKey);
  if (slug) keyMap.set(slug, urls);
}
for (const [slug, oldKey] of Object.entries(SLUG_TO_OLD_KEY)) {
  const urls = keyMap.get(slug) ?? manifest[slug]; // already remapped or direct
  if (!urls) throw new Error(`No manifest images found for product slug "${slug}" (old key "${oldKey}")`);
  remapped[slug] = urls;
}
// keep everything that is NOT a product image key (banners, categories, legacy)
const productOldKeys = new Set(Object.values(SLUG_TO_OLD_KEY));
const productSlugs = new Set(Object.keys(SLUG_TO_OLD_KEY));
for (const [k, v] of Object.entries(manifest)) {
  if (!productOldKeys.has(k) && !productSlugs.has(k)) remapped[k] = v;
}

// verify every referenced file actually exists on disk
let missing = 0;
for (const urls of Object.values(remapped)) {
  for (const u of urls) {
    const p = join(PUBLIC, u);
    if (!u.startsWith("/") || !existsSync(p) || !statSync(p).size) {
      console.error(`  !! missing file: ${u}`);
      missing++;
    }
  }
}
if (missing > 0) throw new Error(`${missing} manifest files missing on disk — aborting`);

writeFileSync(MANIFEST_PATH, JSON.stringify(remapped, null, 2) + "\n");
console.log(`✓ manifest re-keyed: ${Object.keys(remapped).length} keys (all files verified on disk)`);

// ── Step 2: backfill live DB ──
const db = new PrismaClient();
const products = await db.product.findMany({
  select: { id: true, name: true, slug: true, images: { select: { id: true } } },
});
let fixed = 0;
for (const p of products) {
  if (p.images.length > 0) continue; // already has images
  const urls = remapped[p.slug];
  if (!urls?.length) {
    console.warn(`  ?? product "${p.name}" (${p.slug}) has no images and no manifest entry — leaving as-is`);
    continue;
  }
  await db.productImage.createMany({
    data: urls.map((url, i) => ({ productId: p.id, url, alt: `${p.name} — image ${i + 1}`, sortOrder: i })),
  });
  fixed++;
  console.log(`  + ${p.name}: ${urls.length} images`);
}
console.log(`✓ backfilled images for ${fixed} products`);

// ── Step 3: report ──
const after = await db.product.findMany({
  select: { name: true, slug: true, _count: { select: { images: true } } },
  orderBy: { name: "asc" },
});
const zero = after.filter((p) => p._count.images === 0);
console.log(`Products: ${after.length} | with images: ${after.length - zero.length} | still without: ${zero.length}`);
if (zero.length) console.log("Still without images:", zero.map((p) => p.slug).join(", "));
await db.$disconnect();
