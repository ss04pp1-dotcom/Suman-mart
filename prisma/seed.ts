/**
 * ShopNest database seed — creates a complete store with 30 days of history:
 * catalog, customers, orders, suppliers, tracking sessions/events, analytics.
 *
 * Run: bun prisma/seed.ts
 *
 * Admin credentials come from the environment:
 *   ADMIN_SEED_EMAIL     (default admin@shopnest.com)
 *   ADMIN_SEED_PASSWORD  (when unset a random password is generated, printed
 *                         once and the account is flagged mustChangePassword)
 */
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";
import { stringifyJSON } from "../src/lib/json";
import manifest from "../scripts/image-manifest.json";
import { generateOrdersAndTracking } from "./seed-orders";

const db = new PrismaClient();

// ── Deterministic RNG ─────────────────────────────────────────────
let seedState = 42;
function rand(): number {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

const now = new Date();
function daysAgo(days: number, hourJitter = true): Date {
  const d = new Date(now.getTime() - days * 86400_000);
  if (hourJitter) d.setHours(randInt(8, 22), randInt(0, 59), randInt(0, 59), 0);
  return d;
}

async function main() {
  console.log("🌱 Seeding ShopNest…");

  // ── 0. Clear (FK-safe order) ──────────────────────────────────
  await db.$transaction([
    db.auditLog.deleteMany(),
    db.notification.deleteMany(),
    db.cookieConsent.deleteMany(),
    db.trackingEvent.deleteMany(),
    db.trackingSession.deleteMany(),
    db.trackingIntegration.deleteMany(),
    db.supplierOrder.deleteMany(),
    db.supplierSyncLog.deleteMany(),
    db.supplierProduct.deleteMany(),
    db.supplier.deleteMany(),
    db.review.deleteMany(),
    db.orderItem.deleteMany(),
    db.orderStatusHistory.deleteMany(),
    db.payment.deleteMany(),
    db.order.deleteMany(),
    db.address.deleteMany(),
    db.customer.deleteMany(),
    db.admin.deleteMany(),
    db.banner.deleteMany(),
    db.homepageSection.deleteMany(),
    db.coupon.deleteMany(),
    db.productRelation.deleteMany(),
    db.productTag.deleteMany(),
    db.productVariant.deleteMany(),
    db.productImage.deleteMany(),
    db.tag.deleteMany(),
    db.product.deleteMany(),
    db.category.deleteMany(),
    db.setting.deleteMany(),
  ]);

  // ── 1. Admins ─────────────────────────────────────────────────
  const adminEmail = (process.env.ADMIN_SEED_EMAIL ?? "admin@shopnest.com").toLowerCase().trim();
  const providedPassword = process.env.ADMIN_SEED_PASSWORD;
  const adminPassword = providedPassword ?? `SN-${randomBytes(6).toString("base64url")}`;
  const mustChange = !providedPassword;
  // Demo customer account password (all seeded demo customers share it)
  const customerPassword = providedPassword ?? `cust-${randomBytes(5).toString("base64url")}`;

  console.log("──────────────────────────────────────────────────────");
  console.log("  Seeded credentials (store them now — shown only here)");
  console.log(`  Admin:   ${adminEmail}  /  ${providedPassword ? "(ADMIN_SEED_PASSWORD from env)" : adminPassword}`);
  console.log(`  Customer: customer@shopnest.com  /  ${providedPassword ? "(same as ADMIN_SEED_PASSWORD)" : customerPassword}`);
  if (mustChange) console.log("  → The admin account must set a new password on first login.");
  console.log("──────────────────────────────────────────────────────\n");

  const pw = await hashPassword(adminPassword);
  const custPw = await hashPassword(customerPassword);
  const admins = await Promise.all([
    db.admin.create({ data: { name: "Nusrat Jahan", email: adminEmail, passwordHash: pw, role: "SUPER_ADMIN", mustChangePassword: mustChange } }),
    db.admin.create({ data: { name: "Rakib Hasan", email: "manager@shopnest.com", passwordHash: pw, role: "MANAGER", mustChangePassword: mustChange } }),
    db.admin.create({ data: { name: "Tanvir Ahmed", email: "marketing@shopnest.com", passwordHash: pw, role: "MARKETING", mustChangePassword: mustChange } }),
    db.admin.create({ data: { name: "Farhana Akter", email: "support@shopnest.com", passwordHash: pw, role: "SUPPORT", mustChangePassword: mustChange } }),
  ]);
  void admins;

  // ── 2. Categories ─────────────────────────────────────────────
  const catData = [
    { name: "Electronics", slug: "electronics", description: "Gadgets, audio, wearables and smart accessories.", imageUrl: "/categories/electronics-1.jpg", sortOrder: 1 },
    { name: "Fashion", slug: "fashion", description: "Apparel, footwear and everyday style.", imageUrl: "/categories/fashion-1.jpg", sortOrder: 2 },
    { name: "Home & Living", slug: "home-living", description: "Cozy essentials for every corner of your home.", imageUrl: "/categories/home-living-1.jpg", sortOrder: 3 },
    { name: "Beauty & Care", slug: "beauty-care", description: "Skincare, makeup and personal care picks.", imageUrl: "/categories/beauty-1.jpg", sortOrder: 4 },
    { name: "Sports & Outdoors", slug: "sports-outdoors", description: "Fitness gear for home and outdoor training.", imageUrl: "/categories/sports-1.jpg", sortOrder: 5 },
    { name: "Bags & Accessories", slug: "bags-accessories", description: "Carry essentials, wallets and everyday carry.", imageUrl: "/categories/accessories-1.jpg", sortOrder: 6 },
    { name: "Toys & Games", slug: "toys-games", description: "Playful finds for kids and the young at heart.", imageUrl: "/categories/toys-games-1.jpg", sortOrder: 7 },
    { name: "Groceries", slug: "groceries", description: "Premium pantry staples and organic selects.", imageUrl: "/categories/groceries-1.jpg", sortOrder: 8 },
  ];
  const cats = await Promise.all(catData.map((c) => db.category.create({ data: c })));
  const catByName = Object.fromEntries(cats.map((c) => [c.name, c]));

  // ── 3. Tags ───────────────────────────────────────────────────
  const tagNames = ["bestseller", "new-arrival", "trending", "gift", "eco-friendly", "premium", "sale", "ramadan", "eid", "work-from-home"];
  const tags = await Promise.all(tagNames.map((t) => db.tag.create({ data: { name: t.replace(/-/g, " "), slug: t } })));

  // ── 4. Products ───────────────────────────────────────────────
  interface PDef {
    slug: string; name: string; cat: string; price: number; compare?: number; brand: string;
    short: string; stock: number; featured?: boolean; supplierExt?: string;
    variants?: { group: string; options: { label: string; stock: number }[] }[];
    specs: { group: string; key: string; value: string }[];
    tags: string[];
  }

  const defs: PDef[] = [
    { slug: "wireless-earbuds-pro", name: "Wireless Earbuds Pro", cat: "Electronics", price: 2790, compare: 3490, brand: "SoundCore", short: "ANC earbuds with 36h battery and crystal-clear calls.", stock: 145, featured: true, supplierExt: "DW-1001", variants: [{ group: "Color", options: [{ label: "Black", stock: 90 }, { label: "White", stock: 55 }] }], specs: [{ group: "Audio", key: "Driver", value: "13mm dynamic" }, { group: "Audio", key: "ANC", value: "Up to 25dB" }, { group: "Battery", key: "Playtime", value: "36h with case" }, { group: "Rating", key: "Water resistance", value: "IPX5" }], tags: ["bestseller", "trending"] },
    { slug: "smart-watch-series-x", name: "Smart Watch Series X", cat: "Electronics", price: 3490, compare: 4290, brand: "FitPro", short: "1.9 inch AMOLED display with health and fitness tracking.", stock: 82, featured: true, supplierExt: "DW-1002", variants: [{ group: "Color", options: [{ label: "Black", stock: 50 }, { label: "Silver", stock: 32 }] }], specs: [{ group: "Display", key: "Screen", value: "1.9 inch AMOLED" }, { group: "Battery", key: "Capacity", value: "320mAh, 7-day standby" }, { group: "Sensors", key: "Tracking", value: "Heart rate, SpO2, sleep" }], tags: ["bestseller", "gift"] },
    { slug: "portable-bluetooth-speaker", name: "Portable Bluetooth Speaker", cat: "Electronics", price: 2190, compare: 2690, brand: "BoomAudio", short: "20W room-filling sound with 12h playtime and IPX6.", stock: 64, supplierExt: "DW-1003", specs: [{ group: "Audio", key: "Output", value: "20W RMS" }, { group: "Battery", key: "Playtime", value: "12 hours" }, { group: "Rating", key: "Water resistance", value: "IPX6" }], tags: ["trending"] },
    { slug: "gan-fast-charger-65w", name: "65W GaN Fast Charger", cat: "Electronics", price: 1290, brand: "VoltMax", short: "Three-port GaN charger for phones, tablets and laptops.", stock: 120, specs: [{ group: "Power", key: "Output", value: "65W max (PD 3.0)" }, { group: "Ports", key: "Configuration", value: "2×USB-C + 1×USB-A" }], tags: ["work-from-home"] },
    { slug: "power-bank-20000mah", name: "Power Bank 20000mAh", cat: "Electronics", price: 1890, compare: 2290, brand: "VoltMax", short: "22.5W fast charging power bank with triple output.", stock: 58, supplierExt: "DW-1004", specs: [{ group: "Power", key: "Capacity", value: "20000mAh" }, { group: "Power", key: "Output", value: "22.5W max" }, { group: "Ports", key: "Configuration", value: "2×USB-A + 1×USB-C" }], tags: ["bestseller"] },
    { slug: "mechanical-keyboard-rgb", name: "Mechanical Keyboard RGB", cat: "Electronics", price: 3590, brand: "KeyForce", short: "Hot-swappable switches with per-key RGB lighting.", stock: 34, supplierExt: "DW-1005", variants: [{ group: "Switch", options: [{ label: "Red", stock: 18 }, { label: "Blue", stock: 16 }] }], specs: [{ group: "Switches", key: "Type", value: "Hot-swappable linear" }, { group: "Lighting", key: "RGB", value: "Per-key 16.8M colors" }, { group: "Layout", key: "Form factor", value: "87-key TKL" }], tags: ["work-from-home", "premium"] },
    { slug: "wireless-silent-mouse", name: "Wireless Silent Mouse", cat: "Electronics", price: 890, brand: "KeyForce", short: "Silent-click wireless mouse with 18-month battery life.", stock: 210, supplierExt: "DW-1006", specs: [{ group: "Connectivity", key: "Wireless", value: "2.4GHz USB receiver" }, { group: "Battery", key: "Life", value: "18 months (AA)" }], tags: ["work-from-home"] },
    { slug: "usb-c-hub-7in1", name: "USB-C Hub 7-in-1", cat: "Electronics", price: 1650, brand: "VoltMax", short: "HDMI 4K, LAN, SD and 100W passthrough in one hub.", stock: 47, specs: [{ group: "Ports", key: "Configuration", value: "HDMI 4K60, LAN, 2×USB 3.0, SD/microSD, PD 100W" }], tags: [] },
    { slug: "swiftrun-running-sneakers", name: "SwiftRun Running Sneakers", cat: "Fashion", price: 2990, compare: 3790, brand: "SwiftRun", short: "Breathable knit runners with cushioned EVA sole.", stock: 75, featured: true, variants: [{ group: "Size", options: [{ label: "40", stock: 12 }, { label: "41", stock: 18 }, { label: "42", stock: 22 }, { label: "43", stock: 15 }, { label: "44", stock: 8 }] }], specs: [{ group: "Material", key: "Upper", value: "Engineered knit" }, { group: "Sole", key: "Type", value: "Cushioned EVA" }], tags: ["bestseller", "trending"] },
    { slug: "classic-denim-jacket", name: "Classic Denim Jacket", cat: "Fashion", price: 3250, brand: "UrbanPath", short: "Timeless washed denim jacket with a relaxed fit.", stock: 40, variants: [{ group: "Size", options: [{ label: "M", stock: 14 }, { label: "L", stock: 16 }, { label: "XL", stock: 10 }] }], specs: [{ group: "Material", key: "Fabric", value: "100% cotton denim" }, { group: "Care", key: "Wash", value: "Machine wash cold" }], tags: ["new-arrival"] },
    { slug: "premium-cotton-tee", name: "Premium Cotton Tee", cat: "Fashion", price: 790, brand: "UrbanPath", short: "Soft combed cotton tee in a classic regular fit.", stock: 260, variants: [{ group: "Size", options: [{ label: "S", stock: 50 }, { label: "M", stock: 80 }, { label: "L", stock: 80 }, { label: "XL", stock: 50 }] }, { group: "Color", options: [{ label: "White", stock: 140 }, { label: "Navy", stock: 120 }] }], specs: [{ group: "Material", key: "Fabric", value: "100% combed cotton, 180 GSM" }], tags: ["bestseller"] },
    { slug: "leather-crossbody-bag", name: "Leather Crossbody Bag", cat: "Fashion", price: 2450, compare: 2990, brand: "UrbanPath", short: "Compact genuine-leather crossbody with adjustable strap.", stock: 36, specs: [{ group: "Material", key: "Outer", value: "Genuine leather" }, { group: "Size", key: "Dimensions", value: "22 × 15 × 7 cm" }], tags: ["gift", "premium"] },
    { slug: "polarized-sunglasses", name: "Polarized Sunglasses", cat: "Fashion", price: 1490, brand: "SunShield", short: "UV400 polarized lenses in a lightweight metal frame.", stock: 90, variants: [{ group: "Lens", options: [{ label: "Black", stock: 55 }, { label: "Brown", stock: 35 }] }], specs: [{ group: "Lens", key: "Protection", value: "UV400 polarized" }, { group: "Frame", key: "Material", value: "Alloy + acetate" }], tags: ["trending"] },
    { slug: "heritage-analog-watch", name: "Heritage Analog Watch", cat: "Fashion", price: 4890, compare: 5990, brand: "Horsden", short: "Minimalist 40mm analog watch with leather strap.", stock: 24, featured: true, specs: [{ group: "Movement", key: "Type", value: "Japanese quartz" }, { group: "Case", key: "Size", value: "40mm stainless steel" }, { group: "Water", key: "Resistance", value: "3 ATM" }], tags: ["premium", "gift"] },
    { slug: "ceramic-mug-set-4", name: "Ceramic Mug Set (4pc)", cat: "Home & Living", price: 1190, brand: "NestHome", short: "Hand-glazed stoneware mugs in warm neutral tones.", stock: 85, specs: [{ group: "Material", key: "Type", value: "Glazed stoneware" }, { group: "Capacity", key: "Volume", value: "350ml each" }, { group: "Care", key: "Safety", value: "Dishwasher & microwave safe" }], tags: ["gift"] },
    { slug: "vanilla-scented-candle", name: "Vanilla Scented Candle", cat: "Home & Living", price: 690, brand: "NestHome", short: "Soy-wax candle with 45h burn time and cotton wick.", stock: 130, specs: [{ group: "Material", key: "Wax", value: "100% soy wax" }, { group: "Burn", key: "Time", value: "~45 hours" }], tags: ["eco-friendly", "gift"] },
    { slug: "nordic-table-lamp", name: "Nordic Table Lamp", cat: "Home & Living", price: 2390, compare: 2890, brand: "NestHome", short: "Warm oak-finish lamp with linen shade.", stock: 42, featured: true, specs: [{ group: "Material", key: "Base", value: "Solid oak" }, { group: "Light", key: "Bulb", value: "E27, max 40W (included)" }], tags: ["new-arrival", "premium"] },
    { slug: "throw-pillow-covers-2", name: "Throw Pillow Covers (2pc)", cat: "Home & Living", price: 890, brand: "NestHome", short: "Woven boho cushion covers, 45×45cm.", stock: 95, specs: [{ group: "Material", key: "Fabric", value: "Cotton-linen blend" }, { group: "Size", key: "Dimensions", value: "45 × 45 cm" }], tags: [] },
    { slug: "foldable-storage-organizer", name: "Foldable Storage Organizer Set", cat: "Home & Living", price: 1090, brand: "NestHome", short: "Set of 3 collapsible bins with handles.", stock: 70, specs: [{ group: "Material", key: "Fabric", value: "Non-woven polypropylene" }, { group: "Size", key: "Set", value: "S / M / L" }], tags: [] },
    { slug: "vitamin-c-serum-20", name: "Vitamin C Serum 20%", cat: "Beauty & Care", price: 1350, brand: "GlowLab", short: "Brightening serum with 20% vitamin C and hyaluronic acid.", stock: 110, featured: true, specs: [{ group: "Formula", key: "Active", value: "20% L-ascorbic acid" }, { group: "Volume", key: "Size", value: "30ml" }], tags: ["bestseller", "premium"] },
    { slug: "gentle-facial-cleanser", name: "Gentle Facial Cleanser", cat: "Beauty & Care", price: 850, brand: "GlowLab", short: "pH-balanced gel cleanser for daily use.", stock: 140, specs: [{ group: "Formula", key: "Type", value: "Sulfate-free gel" }, { group: "Volume", key: "Size", value: "150ml" }], tags: [] },
    { slug: "matte-lipstick-set-5", name: "Matte Lipstick Set (5 shades)", cat: "Beauty & Care", price: 1590, compare: 1990, brand: "Bella", short: "Transfer-proof matte lipsticks in five everyday shades.", stock: 60, specs: [{ group: "Formula", key: "Finish", value: "Matte, transfer-proof" }, { group: "Set", key: "Shades", value: "5 × 3.5g" }], tags: ["gift", "sale"] },
    { slug: "ionic-hair-dryer-2000w", name: "Ionic Hair Dryer 2000W", cat: "Beauty & Care", price: 2790, brand: "AirStyle", short: "Frizz-reducing ionic dryer with cool shot.", stock: 38, specs: [{ group: "Power", key: "Motor", value: "2000W AC motor" }, { group: "Features", key: "Technology", value: "Ionic + cool shot" }], tags: [] },
    { slug: "eco-yoga-mat-8mm", name: "Eco Yoga Mat 8mm", cat: "Sports & Outdoors", price: 1290, compare: 1590, brand: "FlexFit", short: "Non-slip TPE mat with alignment lines.", stock: 66, supplierExt: "DW-1007", specs: [{ group: "Material", key: "Type", value: "Eco TPE" }, { group: "Size", key: "Dimensions", value: "183 × 61 cm, 8mm" }], tags: ["eco-friendly", "new-arrival"] },
    { slug: "adjustable-dumbbell-pair", name: "Adjustable Dumbbell Pair", cat: "Sports & Outdoors", price: 4590, brand: "FlexFit", short: "20kg-per-pair dumbbells with quick-lock collars.", stock: 18, specs: [{ group: "Weight", key: "Range", value: "2–20kg per dumbbell" }, { group: "Material", key: "Handle", value: "Knurled steel" }], tags: ["premium"] },
    { slug: "speed-jump-rope", name: "Speed Jump Rope", cat: "Sports & Outdoors", price: 450, brand: "FlexFit", short: "Ball-bearing speed rope with foam grips.", stock: 180, specs: [{ group: "Length", key: "Cable", value: "3m adjustable steel cable" }], tags: ["sale"] },
    { slug: "insulated-steel-bottle-1l", name: "Insulated Steel Bottle 1L", cat: "Sports & Outdoors", price: 990, brand: "HydroNest", short: "24h cold / 12h hot double-wall bottle.", stock: 120, specs: [{ group: "Material", key: "Body", value: "18/8 stainless steel" }, { group: "Insulation", key: "Performance", value: "24h cold, 12h hot" }], tags: ["eco-friendly"] },
    { slug: "armor-phone-case", name: "Armor Phone Case", cat: "Bags & Accessories", price: 550, brand: "CaseUp", short: "Military-grade drop protection with raised bezels.", stock: 300, variants: [{ group: "Model", options: [{ label: "iPhone 15", stock: 90 }, { label: "iPhone 14", stock: 90 }, { label: "Galaxy S24", stock: 120 }] }], specs: [{ group: "Protection", key: "Rating", value: "MIL-STD 810G" }], tags: ["bestseller"] },
    { slug: "voyager-laptop-backpack-25l", name: "Voyager Laptop Backpack 25L", cat: "Bags & Accessories", price: 2350, compare: 2790, brand: "Voyager", short: "Water-resistant backpack with 15.6 inch laptop bay.", stock: 55, featured: true, supplierExt: "DW-1008", specs: [{ group: "Capacity", key: "Volume", value: "25 liters" }, { group: "Material", key: "Fabric", value: "Water-resistant polyester" }, { group: "Compartment", key: "Laptop", value: "Fits up to 15.6 inch" }], tags: ["bestseller", "work-from-home"] },
    { slug: "genuine-leather-wallet", name: "Genuine Leather Wallet", cat: "Bags & Accessories", price: 1750, brand: "UrbanPath", short: "Slim bifold with RFID-blocking lining.", stock: 80, specs: [{ group: "Material", key: "Outer", value: "Full-grain leather" }, { group: "Security", key: "RFID", value: "Blocking lining" }], tags: ["gift"] },
    { slug: "magnetic-car-phone-mount", name: "Magnetic Car Phone Mount", cat: "Bags & Accessories", price: 790, brand: "CaseUp", short: "Strong magnetic mount with 360 degree rotation.", stock: 150, specs: [{ group: "Mount", key: "Type", value: "Magnetic dash/windshield" }], tags: [] },
    { slug: "creative-building-blocks-500", name: "Creative Building Blocks 500pc", cat: "Toys & Games", price: 1490, brand: "BrickWorks", short: "500-piece block set with idea booklet.", stock: 62, specs: [{ group: "Pieces", key: "Count", value: "500" }, { group: "Age", key: "Range", value: "6+ years" }], tags: ["gift"] },
    { slug: "rc-rally-car-2-4ghz", name: "RC Rally Car 2.4GHz", cat: "Toys & Games", price: 1990, compare: 2490, brand: "PlayTech", short: "30km/h RC car with proportional steering.", stock: 28, specs: [{ group: "Speed", key: "Max", value: "30 km/h" }, { group: "Battery", key: "Playtime", value: "25 min per charge" }], tags: ["sale"] },
    { slug: "cuddly-plush-bear-40cm", name: "Cuddly Plush Bear 40cm", cat: "Toys & Games", price: 1250, brand: "PlayTech", short: "Hypoallergenic plush bear, surface washable.", stock: 74, specs: [{ group: "Size", key: "Height", value: "40 cm" }], tags: ["gift"] },
    { slug: "sundarban-organic-honey-500g", name: "Sundarban Organic Honey 500g", cat: "Groceries", price: 850, brand: "Sundarban Gold", short: "Raw unprocessed honey from the Sundarbans.", stock: 100, specs: [{ group: "Type", key: "Process", value: "Raw, unheated" }, { group: "Weight", key: "Net", value: "500g" }], tags: ["eco-friendly", "premium"] },
    { slug: "premium-green-tea-250g", name: "Premium Green Tea 250g", cat: "Groceries", price: 550, brand: "LeafGarden", short: "First-flush green tea, loose leaf.", stock: 160, specs: [{ group: "Type", key: "Grade", value: "First flush, loose leaf" }], tags: [] },
    { slug: "premium-kimia-dates-1kg", name: "Premium Kimia Dates 1kg", cat: "Groceries", price: 1390, compare: 1650, brand: "Oasis", short: "Soft caramel-like Kimia dates, seedless.", stock: 88, specs: [{ group: "Type", key: "Variety", value: "Kimia, seedless" }, { group: "Weight", key: "Net", value: "1kg" }], tags: ["ramadan", "eid", "bestseller"] },
  ];

  const products: Record<string, { id: string; price: number; name: string; slug: string; stock: number; supplierExt?: string }> = {};

  for (const def of defs) {
    const images = (manifest as Record<string, string[]>)[def.slug] ?? [];
    const created = await db.product.create({
      data: {
        name: def.name,
        slug: def.slug,
        shortDescription: def.short,
        description: `${def.short}\n\nThe ${def.name} from ${def.brand} is part of the ShopNest curated collection — hand-picked for quality, value and fast delivery across Bangladesh. Every order is inspected before dispatch and covered by our 7-day easy return policy.\n\nKey highlights:\n• Genuine ${def.brand} product with warranty support\n• Quality checked before shipping\n• Cash on delivery available nationwide\n• 7-day hassle-free returns`,
        price: def.price,
        compareAtPrice: def.compare ?? null,
        costPrice: Math.round(def.price * 0.62),
        sku: `SN-${def.slug.toUpperCase().replace(/-/g, "").slice(0, 12)}`,
        stock: def.stock,
        lowStockThreshold: 5,
        isActive: true,
        isFeatured: def.featured ?? false,
        brand: def.brand,
        specifications: stringifyJSON(def.specs),
        seoTitle: `${def.name} — Buy Online in Bangladesh`,
        seoDescription: def.short,
        categoryId: catByName[def.cat].id,
        images: { create: images.map((url, i) => ({ url, alt: `${def.name} — image ${i + 1}`, sortOrder: i })) },
        variants: def.variants
          ? {
              create: def.variants.flatMap((v) =>
                v.options.map((o, i) => ({
                  name: v.group,
                  options: stringifyJSON({ [v.group]: o.label }),
                  sku: `SN-${def.slug.toUpperCase().slice(0, 8)}-${v.group.slice(0, 2).toUpperCase()}${i}`,
                  stock: o.stock,
                  sortOrder: i,
                }))
              ),
            }
          : undefined,
        tags: { create: def.tags.map((t) => ({ tagId: tags.find((tg) => tg.slug === t)!.id })) },
        createdAt: daysAgo(randInt(35, 120)),
      },
    });
    products[def.slug] = { id: created.id, price: created.price, name: created.name, slug: created.slug, stock: created.stock, supplierExt: def.supplierExt };
  }

  // Low-stock + unpublished demo states
  await db.product.update({ where: { slug: "adjustable-dumbbell-pair" }, data: { stock: 3, lowStockThreshold: 5 } });
  await db.product.update({ where: { slug: "ionic-hair-dryer-2000w" }, data: { stock: 2, lowStockThreshold: 6 } });
  await db.product.update({ where: { slug: "rc-rally-car-2-4ghz" }, data: { stock: 0 } });

  // ── 5. Suppliers ──────────────────────────────────────────────
  const supplier1 = await db.supplier.create({
    data: {
      name: "Dhaka Wholesale Hub",
      code: "DWH",
      email: "orders@dhakawholesale.example",
      phone: "+880 1711-111111",
      adapter: "demo-wholesale-v1",
      autoSyncPrice: true,
      autoSyncStock: true,
      config: stringifyJSON({ markupPercent: 30, autoCreateProducts: false }),
      isActive: true,
      notes: "Primary dropshipping partner for electronics and fitness. Ships via Steadfast in 2–5 days.",
      lastSyncAt: daysAgo(0.2),
    },
  });
  const supplier2 = await db.supplier.create({
    data: {
      name: "Chattogram Traders",
      code: "CTG",
      email: "b2b@ctgtraders.example",
      phone: "+880 1811-222222",
      adapter: "demo-wholesale-v1",
      autoSyncPrice: false,
      autoSyncStock: true,
      config: stringifyJSON({ markupPercent: 25 }),
      isActive: true,
      notes: "Backup supplier for home & living categories.",
      lastSyncAt: daysAgo(3),
    },
  });
  void supplier2;

  // Supplier products — linked items must match demo-catalog externalIds
  const supplierProductsByExt: Record<string, string> = {};
  for (const def of defs) {
    if (!def.supplierExt) continue;
    const sp = await db.supplierProduct.create({
      data: {
        supplierId: supplier1.id,
        productId: products[def.slug].id,
        externalId: def.supplierExt,
        name: `${def.name} (Wholesale)`,
        description: def.short,
        images: stringifyJSON((manifest as Record<string, string[]>)[def.slug] ?? []),
        price: Math.round(def.price * 0.65),
        stock: def.stock,
        sku: `${def.supplierExt}-W`,
        category: def.cat,
        variants: stringifyJSON([]),
        lastSyncedAt: daysAgo(0.2),
      },
    });
    supplierProductsByExt[def.supplierExt] = sp.id;
  }
  // Unlinked supplier-only items (importable from admin)
  const unlinkedFeed = [
    { ext: "DW-2002", name: "15W Fast Wireless Charging Pad", price: 890, stock: 120, cat: "Electronics" },
    { ext: "DW-2004", name: "Insulated Travel Tumbler 450ml", price: 750, stock: 88, cat: "Home & Living" },
    { ext: "DW-2005", name: "Memory Foam Lumbar Cushion", price: 1200, stock: 45, cat: "Home & Living" },
  ];
  for (const f of unlinkedFeed) {
    await db.supplierProduct.create({
      data: {
        supplierId: supplier1.id,
        externalId: f.ext,
        name: f.name,
        images: stringifyJSON([]),
        price: f.price,
        stock: f.stock,
        category: f.cat,
        variants: stringifyJSON([]),
        lastSyncedAt: daysAgo(1),
      },
    });
  }

  // Sync log history
  const syncTypes = ["PRODUCTS", "PRICES", "STOCK"] as const;
  for (let i = 0; i < 16; i++) {
    const type = syncTypes[i % 3];
    const failed = rand() < 0.12;
    await db.supplierSyncLog.create({
      data: {
        supplierId: supplier1.id,
        type,
        status: failed ? "PARTIAL" : "SUCCESS",
        message: failed ? "2 items failed: supplier API timeout (item DW-2005, DW-2006)" : "Scheduled sync completed.",
        itemsProcessed: type === "PRODUCTS" ? 14 : 8,
        itemsCreated: type === "PRODUCTS" ? 0 : 0,
        itemsUpdated: type === "PRODUCTS" ? 14 : 8,
        itemsFailed: failed ? 2 : 0,
        durationMs: randInt(900, 4800),
        createdAt: daysAgo(randInt(0, 25)),
      },
    });
  }

  // ── 6. Customers ──────────────────────────────────────────────
  const customerSeed = [
    { name: "Demo Customer", email: "customer@shopnest.com", phone: "01712345678" },
    { name: "Ayesha Siddika", email: "ayesha.s@example.com", phone: "01711000001" },
    { name: "Mehedi Hasan", email: "mehedi.h@example.com", phone: "01711000002" },
    { name: "Sadia Islam", email: "sadia.i@example.com", phone: "01711000003" },
    { name: "Rafiq Uddin", email: "rafiq.u@example.com", phone: "01711000004" },
    { name: "Nabila Chowdhury", email: "nabila.c@example.com", phone: "01711000005" },
    { name: "Imran Kabir", email: "imran.k@example.com", phone: "01711000006" },
    { name: "Tasnim Rahman", email: "tasnim.r@example.com", phone: "01711000007" },
    { name: "Jahid Hussain", email: "jahid.h@example.com", phone: "01711000008" },
    { name: "Sharmin Akter", email: "sharmin.a@example.com", phone: "01711000009" },
    { name: "Fahim Shahriar", email: "fahim.s@example.com", phone: "01711000010" },
    { name: "Rumana Haque", email: "rumana.h@example.com", phone: "01711000011" },
  ];
  const cities = [
    { city: "Dhaka", areas: ["Dhanmondi", "Gulshan", "Mirpur", "Uttara", "Banani", "Mohakhali", "Bashundhara"] },
    { city: "Chattogram", areas: ["Agrabad", "Khulshi", "Nasirabad"] },
    { city: "Sylhet", areas: ["Zindabazar", "Amberkhana"] },
    { city: "Khulna", areas: ["Sonadanga", "Khalishpur"] },
    { city: "Rajshahi", areas: ["Uposhohor", "Kazla"] },
  ];

  const customers = await Promise.all(
    customerSeed.map(async (c, i) => {
      const loc = pick(cities);
      return db.customer.create({
        data: {
          name: c.name,
          email: c.email,
          phone: c.phone,
          passwordHash: custPw,
          emailVerifiedAt: daysAgo(randInt(1, 30)),
          createdAt: daysAgo(randInt(20, 200)),
          addresses: {
            create: {
              label: "Home",
              fullName: c.name,
              phone: c.phone,
              line1: `House ${randInt(1, 120)}, Road ${randInt(1, 25)}`,
              city: loc.city,
              area: pick(loc.areas),
              postalCode: `1${randInt(200, 999)}`,
              isDefault: true,
            },
          },
        },
      }).then((created) => ({ ...created, index: i }));
    })
  );

  // ── 7. Coupons ────────────────────────────────────────────────
  await db.coupon.createMany({
    data: [
      { code: "WELCOME10", type: "PERCENTAGE", value: 10, maxDiscount: 300, minOrderAmount: 1000, usageLimit: 500, isActive: true, startsAt: daysAgo(60) },
      { code: "SHOPNEST500", type: "FIXED", value: 500, minOrderAmount: 4000, usageLimit: 200, isActive: true, startsAt: daysAgo(30) },
      { code: "FREESHIP", type: "FREE_SHIPPING", value: 0, minOrderAmount: 800, usageLimit: 1000, isActive: true, startsAt: daysAgo(45) },
      { code: "EID15", type: "PERCENTAGE", value: 15, maxDiscount: 1000, minOrderAmount: 3000, usageLimit: 300, isActive: false, startsAt: daysAgo(90), expiresAt: daysAgo(60) },
      { code: "VIP1000", type: "FIXED", value: 1000, minOrderAmount: 8000, usageLimit: 50, customerId: customers[0].id, isActive: true, startsAt: daysAgo(15) },
    ],
  });

  // ── 8. Banners & homepage sections ────────────────────────────
  await db.banner.createMany({
    data: [
      { title: "Mega Electronics Fest", subtitle: "Up to 40% off on earbuds, smartwatches & more", imageUrl: "/banners/hero-tech-1.jpg", buttonLabel: "Shop Electronics", buttonUrl: "/products?category=electronics", placement: "HERO", theme: "Dark", sortOrder: 1, isActive: true },
      { title: "Fresh Fashion Drop", subtitle: "New arrivals for the season — styled for you", imageUrl: "/banners/hero-fashion-1.jpg", buttonLabel: "Explore Fashion", buttonUrl: "/products?category=fashion", placement: "HERO", theme: "Dark", sortOrder: 2, isActive: true },
      { title: "Free Delivery Over ৳2,000", subtitle: "Fast nationwide shipping with cash on delivery", imageUrl: "/banners/hero-shopping-1.jpg", buttonLabel: "Start Shopping", buttonUrl: "/products", placement: "HERO", theme: "Dark", sortOrder: 3, isActive: true },
      { title: "Weekend Flash Sale — Extra 10% Off", subtitle: "Use code WELCOME10 at checkout", imageUrl: "/banners/promo-sale-1.jpg", buttonLabel: "Grab the Deal", buttonUrl: "/products?sort=discount", placement: "PROMO", theme: "Dark", sortOrder: 1, isActive: true },
    ],
  });
  await db.homepageSection.createMany({
    data: [
      { key: "categories", type: "categories", title: "Shop by Category", subtitle: "Find exactly what you need", sortOrder: 1 },
      { key: "featured", type: "featured", title: "Featured Products", subtitle: "Hand-picked favorites from our team", sortOrder: 2 },
      { key: "specialOffers", type: "specialOffers", title: "Special Offers", subtitle: "Limited-time deals you will love", sortOrder: 3 },
      { key: "newArrivals", type: "newArrivals", title: "New Arrivals", subtitle: "Fresh finds added this week", sortOrder: 4 },
      { key: "bestSellers", type: "bestSellers", title: "Best Sellers", subtitle: "What everyone is buying right now", sortOrder: 5 },
      { key: "reviews", type: "reviews", title: "Loved by Customers", subtitle: "Real reviews from verified buyers", sortOrder: 6 },
      { key: "whyUs", type: "whyUs", title: "Why Shop With Us", subtitle: "Shopping built around you", sortOrder: 7 },
      { key: "shipping", type: "shipping", title: "Fast & Reliable Delivery", subtitle: null, sortOrder: 8 },
    ],
  });

  // ── 9. Tracking integrations ──────────────────────────────────
  await db.trackingIntegration.createMany({
    data: [
      { provider: "META", config: stringifyJSON({ pixelId: "1122334455667788" }), secrets: stringifyJSON({}), isEnabled: true, status: "CONNECTED", lastCheckedAt: daysAgo(0.5) },
      { provider: "GOOGLE", config: stringifyJSON({ ga4MeasurementId: "G-SHOPNEST01", adsConversionId: "", conversionLabel: "", gtmId: "" }), secrets: stringifyJSON({}), isEnabled: true, status: "CONNECTED", lastCheckedAt: daysAgo(0.5) },
      { provider: "TIKTOK", config: stringifyJSON({ pixelId: "" }), secrets: stringifyJSON({}), isEnabled: false, status: "DISABLED" },
      { provider: "CUSTOM", config: stringifyJSON({ endpoint: "", headerName: "X-Api-Key" }), secrets: stringifyJSON({}), isEnabled: false, status: "DISABLED" },
    ],
  });

  console.log("✅ Catalog, customers, suppliers, marketing seeded. Generating orders & tracking…");

  await generateOrdersAndTracking(db, {
    products,
    customers: customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email, createdAt: c.createdAt })),
    supplierId: supplier1.id,
    supplierProductsByExt,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
