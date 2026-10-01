#!/usr/bin/env node
// Local-development seed for the Workers API (wrangler dev's local D1 + R2).
//
// Applies the REAL wrangler migrations, then seeds the same fixture data the
// integration tests use (plus a real admin account with a PBKDF2-hashed
// password and a demo supplier) and uploads the seed product images to the
// local R2 bucket.
//
// Usage:  node apps/api/scripts/dev-seed.mjs          (from the monorepo root)
//         bun apps/api/scripts/dev-seed.mjs
//
// Credentials it creates (LOCAL DEV ONLY — never production):
//   admin@shopnest.com / Admin123!SuperSecure   (SUPER_ADMIN)
//   support@shopnest.com / Support123!Pass      (SUPPORT — limited role)

import { execSync } from "node:child_process";
import { writeFileSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, "..");
const storefrontPublic = join(apiDir, "..", "storefront", "public");

const wrangler = (args) => execSync(`bunx wrangler ${args}`, { cwd: apiDir, stdio: "inherit" });

// ── 1. Migrations ──────────────────────────────────────────────────
console.log("→ applying D1 migrations (local)…");
wrangler("d1 migrations apply suman-mart --local");

// ── 2. Admin password hashes (PBKDF2-SHA256, 600k — identical format to
//       src/lib/password.ts) ─────────────────────────────────────────
async function hashPassword(password) {
  const ITERATIONS = 600_000;
  const salt = new Uint8Array(16).map(() => Math.floor(Math.random() * 256));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, key, 256);
  const b64 = (bytes) => Buffer.from(bytes).toString("base64");
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

const adminHash = await hashPassword("Admin123!SuperSecure");
const supportHash = await hashPassword("Support123!Pass");
const customerHash = await hashPassword("BuyerPass123!");
const now = new Date().toISOString().replace("Z", "+00:00");
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ── 3. Seed SQL (same catalogue as tests/seed.ts, plus demo supplier) ──
const sql = `
DELETE FROM OrderItem; DELETE FROM OrderStatusHistory; DELETE FROM Payment; DELETE FROM SupplierOrder; DELETE FROM "Order";
DELETE FROM Review; DELETE FROM ProductRelation; DELETE FROM ProductTag; DELETE FROM ProductVariant; DELETE FROM ProductImage; DELETE FROM Product;
DELETE FROM Coupon; DELETE FROM SupplierProduct; DELETE FROM Supplier; DELETE FROM Category; DELETE FROM Tag;
DELETE FROM Admin; DELETE FROM AdminRecoveryCode; DELETE FROM Customer; DELETE FROM Address;
DELETE FROM Setting; DELETE FROM TrackingIntegration; DELETE FROM TrackingSession; DELETE FROM TrackingEvent; DELETE FROM CookieConsent;
DELETE FROM Notification; DELETE FROM AuditLog; DELETE FROM AuthToken; DELETE FROM GuestEmailOtp; DELETE FROM MailOutbox; DELETE FROM SequenceCounter;

INSERT INTO Category ("id","name","slug","description","imageUrl","sortOrder","isActive") VALUES
 ('cat-electronics','Electronics','electronics','Gadgets and accessories','/categories/electronics-1.jpg',1,1),
 ('cat-fashion','Fashion','fashion','Apparel and footwear','/categories/fashion-1.jpg',2,1),
 ('cat-home','Home & Living','home-living','Cozy essentials','/categories/home-living-1.jpg',3,1);

INSERT INTO Tag ("id","name","slug") VALUES ('tag-wireless','Wireless','wireless'), ('tag-eco','Eco','eco');

INSERT INTO Product
 ("id","name","slug","shortDescription","description","price","compareAtPrice","sku","stock","lowStockThreshold","isActive","isFeatured","brand","rating","reviewCount","soldCount","categoryId","createdAt","updatedAt") VALUES
 ('p1','Wireless Earbuds Pro','wireless-earbuds-pro','Great sound','Long description of earbuds',2500,3500,'SKU-1',10,5,1,1,'Acme',4.5,10,100,'cat-electronics','2026-01-01T00:00:00.000+00:00','2026-01-02T00:00:00.000+00:00'),
 ('p2','Fast Charger 30W','fast-charger','Quick charge','Desc',1200,NULL,'SKU-2',0,5,1,0,'Acme',4.0,5,200,'cat-electronics','2026-01-03T00:00:00.000+00:00','2026-01-04T00:00:00.000+00:00'),
 ('p3','Cotton T-Shirt','cotton-tshirt','Soft tee','Desc',800,1000,'SKU-3',50,5,1,0,'BdWear',4.8,20,300,'cat-fashion','2026-01-05T00:00:00.000+00:00','2026-01-06T00:00:00.000+00:00'),
 ('p4','Denim Jacket','denim-jacket','Stylish','Desc',3200,NULL,'SKU-4',5,5,1,0,'BdWear',4.2,8,40,'cat-fashion','2026-01-07T00:00:00.000+00:00','2026-01-08T00:00:00.000+00:00'),
 ('p5','Table Lamp','table-lamp','Warm light','Desc',1500,1800,'SKU-5',25,5,1,0,'HomeCo',3.9,4,10,'cat-home','2026-01-09T00:00:00.000+00:00','2026-01-10T00:00:00.000+00:00'),
 ('p6','Scented Candle','scented-candle','Lavender','Desc',700,NULL,'SKU-6',100,5,1,0,'HomeCo',4.1,6,60,'cat-home','2026-01-11T00:00:00.000+00:00','2026-01-12T00:00:00.000+00:00');

INSERT INTO ProductImage ("id","productId","url","alt","sortOrder") VALUES
 ('img1','p1','/products/wireless-earbuds-1.jpg','Earbuds',0),
 ('img2','p1','/products/wireless-earbuds-2.jpg','Earbuds alt',1),
 ('img3','p2','/products/fast-charger-1.jpg','Charger',0),
 ('img4','p3','/products/cotton-tshirt-1.jpg','Tee',0),
 ('img5','p4','/products/denim-jacket-1.jpg','Jacket',0),
 ('img6','p5','/products/table-lamp-1.jpg','Lamp',0),
 ('img7','p6','/products/scented-candle-1.jpg','Candle',0);

INSERT INTO ProductVariant ("id","productId","name","options","sku","price","stock","sortOrder") VALUES
 ('v1','p1','Black','{"Color":"Black"}','VAR-1',2600,4,0),
 ('v2','p1','White','{"Color":"White"}','VAR-2',2500,6,1);

INSERT INTO ProductTag ("productId","tagId") VALUES ('p1','tag-wireless'),('p2','tag-wireless'),('p3','tag-eco');

INSERT INTO Review ("id","productId","authorName","rating","title","comment","status","isFeatured","adminReply","verifiedPurchase","createdAt") VALUES
 ('r1','p1','Rafiq',5,'Excellent','Loved it','APPROVED',0,NULL,1,'2026-02-01T00:00:00.000+00:00'),
 ('r2','p1','Karim',4,'Very good','Solid product','APPROVED',1,'Thanks for the review!',1,'2026-02-03T00:00:00.000+00:00');

INSERT INTO ProductRelation ("id","productId","relatedProductId","type","sortOrder") VALUES
 ('rel1','p1','p2','RELATED',0),
 ('rel2','p1','p3','FBT',0),
 ('rel3','p1','p4','FBT',1);

INSERT INTO Setting ("key","value","updatedAt") VALUES
 ('general',${q(JSON.stringify({ storeName: "Suman Mart", tagline: "Everything you love, delivered to your nest", supportPhone: "+880 1700-111111", supportEmail: "support@sumanmart.com", address: "Dhaka, Bangladesh", facebookUrl: "", instagramUrl: "" }))},${q(now)}),
 ('payment',${q(JSON.stringify({ codEnabled: true, bkashEnabled: true, bkashNumber: "01700-000001", nagadEnabled: false, nagadNumber: "", cardEnabled: false }))},${q(now)});

INSERT INTO TrackingIntegration ("id","provider","config","secrets","isEnabled","updatedAt") VALUES
 ('ti1','META','{"pixelId":"1234567890"}','{"capiToken":"SECRET"}',0,${q(now)}),
 ('ti2','GOOGLE','{"ga4MeasurementId":"","gtmId":""}','{}',0,${q(now)}),
 ('ti3','TIKTOK','{"pixelId":""}','{}',0,${q(now)});

INSERT INTO Admin ("id","name","email","passwordHash","role","isActive","mustChangePassword","totpEnabled","createdAt","updatedAt") VALUES
 ('admin-root','Root Admin','admin@shopnest.com',${q(adminHash)},'SUPER_ADMIN',1,0,0,${q(now)},${q(now)}),
 ('admin-support','Support Agent','support@shopnest.com',${q(supportHash)},'SUPPORT',1,0,0,${q(now)},${q(now)});

INSERT INTO Customer ("id","name","email","phone","passwordHash","isActive","tokenVersion","createdAt","updatedAt") VALUES
 ('cust-1','Test Buyer','buyer@shopnest.com','01712345678',${q(customerHash)},1,0,${q(now)},${q(now)});

INSERT INTO Coupon ("id","code","type","value","maxDiscount","startsAt","expiresAt","usageLimit","usageCount","perCustomerLimit","isActive","createdAt") VALUES
 ('coupon-welcome','WELCOME10','PERCENTAGE',10,300,${q(now)},NULL,100,0,1,1,${q(now)});


INSERT INTO HomepageSection ("id","key","type","title","subtitle","sortOrder","isActive") VALUES
 ('hs-1','categories','categories','Shop by Category','Find exactly what you need',1,1),
 ('hs-2','featured','featured','Featured Products','Hand-picked favorites from our team',2,1),
 ('hs-3','specialOffers','specialOffers','Special Offers','Limited-time deals you will love',3,1),
 ('hs-4','newArrivals','newArrivals','New Arrivals','Fresh finds added this week',4,1),
 ('hs-5','bestSellers','bestSellers','Best Sellers','Our most-loved products',5,1),
 ('hs-6','reviews','reviews','What Customers Say','Real reviews from verified buyers',6,1);

INSERT INTO Banner ("id","title","subtitle","imageUrl","buttonLabel","buttonUrl","placement","theme","sortOrder","startsAt","endsAt","isActive") VALUES
 ('bn-1','Mega Electronics Fest','Up to 40% off on earbuds, smartwatches & more','/banners/hero-tech-1.jpg','Shop Electronics','/products?category=electronics','HERO','Dark',1,${q(now)},NULL,1),
 ('bn-2','Fresh Fashion Drop','New arrivals for the season — styled for you','/banners/hero-fashion-1.jpg','Explore Fashion','/products?category=fashion','HERO','Dark',2,${q(now)},NULL,1),
 ('bn-3','Free Delivery Over ৳2,000','Fast nationwide shipping with cash on delivery','/banners/hero-shopping-1.jpg','Start Shopping','/products','HERO','Dark',3,${q(now)},NULL,1),
 ('bn-4','Weekend Flash Sale — Extra 10% Off','Use code WELCOME10 at checkout','/banners/promo-sale-1.jpg','Grab the Deal','/products?sort=discount','PROMO','Dark',1,${q(now)},NULL,1);

INSERT INTO Supplier ("id","name","code","email","phone","adapter","baseUrl","apiKey","apiSecret","autoSyncPrice","autoSyncStock","config","isActive","notes","createdAt","updatedAt") VALUES
 ('supplier-demo','Demo Wholesale','DEMO','sales@demo-wholesale.example','+880 1000-000000','demo-wholesale-v1',NULL,NULL,NULL,1,1,'{"markupPercent":25}',1,'Sandbox supplier — adapter is a DEMO (no real API)',${q(now)},${q(now)});
`;

const tmp = mkdtempSync(join(tmpdir(), "d1-seed-"));
const seedFile = join(tmp, "seed.sql");
writeFileSync(seedFile, sql);
console.log("→ seeding local D1…");
wrangler(`d1 execute suman-mart --local --file ${seedFile}`);

// ── 4. Seed images → local R2 (uploads the storefront's public assets) ──
console.log("→ uploading seed images to local R2…");
for (const dir of ["products", "categories", "banners"]) {
  const dirPath = join(storefrontPublic, dir);
  let files = [];
  try {
    files = readdirSync(dirPath);
  } catch {
    continue;
  }
  for (const file of files) {
    const type = file.endsWith(".png") ? "image/png" : file.endsWith(".webp") ? "image/webp" : file.endsWith(".svg") ? "image/svg+xml" : "image/jpeg";
    execSync(
      `bunx wrangler r2 object put suman-mart-media/${dir}/${file} --file ${join(dirPath, file)} --content-type ${type} --local`,
      { cwd: apiDir, stdio: "inherit" }
    );
  }
}

console.log("\n✔ Local environment seeded.");
console.log("  Admin:     admin@shopnest.com / Admin123!SuperSecure");
console.log("  Support:   support@shopnest.com / Support123!Pass");
console.log("  Customer:  buyer@shopnest.com / BuyerPass123!");
console.log("  Products:  6 (p1 featured w/ variants), coupon WELCOME10 (10%, 1 per customer)");
