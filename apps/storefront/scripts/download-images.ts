/**
 * Downloads verified Unsplash images for the ShopNest catalog.
 * Each entry: [slug, ...photoIds]. Downloads to public/products|banners|categories.
 * Verifies HTTP 200 + image/* + minimum size before accepting.
 */
import { mkdirSync, writeFileSync, existsSync } from "fs";

// Download target: this app's public/ directory (monorepo layout).
const BASE = new URL("..", import.meta.url).pathname.replace(/\/$/, "") + "/public";
const PRODUCTS: Record<string, string[]> = {
  "wireless-earbuds": ["1590658268037-6bf12165a8df", "1505740420928-5e560c06d30e", "1484704849700-f032a568e944"],
  "smart-watch": ["1546868871-7041f2a55e12", "1523275335684-37898b6baf30", "1544117519-31a4b719223d"],
  "bluetooth-speaker": ["1608043152269-423dbba4e7e1", "1589003077984-894e133dabab", "1558537348-c0f8e733989d"],
  "fast-charger": ["1583863788434-e58a36330cf0", "1615663245857-ac93bb7c39e7", "1591290619762-cfa1cc9c0e88"],
  "power-bank": ["1609090136761-df96e3d6dbed", "1585338447937-7082f8fc763d", "1609599861920-aaa1dc0a5437"],
  "mechanical-keyboard": ["1587829741301-dc798b83add3", "1618384887929-16ec33fab9ef", "1595225476474-87563907a212"],
  "wireless-mouse": ["1527864550417-7fd91fc51a46", "1615663245857-ac93bb7c39e7", "1563297007-0686b7003af7"],
  "usb-c-hub": ["1591503055885-1dfa40e99a9c", "1615663245857-ac93bb7c39e7", "1583863788434-e58a36330cf0"],
  "running-sneakers": ["1542291026-7eec264c27ff", "1595950653106-6c9ebd614d3a", "1600185365483-26d7a4cc7519"],
  "denim-jacket": ["1576871337622-98d48d1cf531", "1571945153237-4929e783af4a", "1548126032-079a0fb0099d"],
  "cotton-tshirt": ["1521572163474-6864f9cf17ab", "1576566588028-4147f3842f27", "1556905055-8f358a7a47b2"],
  "crossbody-bag": ["1548036328-c9fa89d128fa", "1584917865442-de89df76afd3", "1590874103328-eac38a683ce7"],
  "polarized-sunglasses": ["1572635196237-14b3f281503f", "1511499767150-a48a237f0083", "1577803645773-f96470509666"],
  "analog-watch": ["1524592094714-0f0654e20314", "1523170335258-f5ed11844a49", "1547996160-81dfa63595aa"],
  "ceramic-mugs": ["1514228742587-6b1558fcca3d", "1481833761820-0509d3217039", "1600224313844-5a847d5c1d68"],
  "scented-candle": ["1578500494198-246f612d3b3d", "1602874801007-bd458bb1b8e6", "1603006775009-8874e2a34eea"],
  "table-lamp": ["1507473885765-e6ed057f782c", "1513506003901-1e6a229e2d15", "1540932239986-30128078f3c5"],
  "throw-pillows": ["1584100936595-c065f7d692ae", "1567016432779-094069958ea5", "1616486338812-3dadae4b4ace"],
  "storage-organizer": ["1558997519-83ea9252edf8", "1584622650111-993a426fbf0a", "1595428774223-ef52624120d2"],
  "vitamin-c-serum": ["1556228578-8c89e6adf883", "1620916566398-39f1143ab7be", "1570172619644-dfd03ed5d881"],
  "facial-cleanser": ["1571781926291-c477ebfd024b", "1556228453-efd6c1ff04f6", "1598440947619-2c35fc9aa908"],
  "lipstick-set": ["1586495777744-4413f21062fa", "1512496015851-a90fb38ba796", "1591360236480-9c6a8cb0a877"],
  "hair-dryer": ["1522338242992-e1a54906a8da", "1560066984-138dadb4c035", "1526947425960-945c6e72858f"],
  "yoga-mat": ["1518611012118-696072aa579a", "1592415270528-3d5b816a2b1e", "1575052814086-f385e2e2ad1b"],
  "dumbbell-set": ["1532029837206-abbe2b7620e3", "1571019613454-1cb2f99b2d8b", "1517963879433-6ad2b056d712"],
  "jump-rope": ["1601422407692-ec4eeec1d60b", "1599058917212-d750089bc07e", "1517836357463-d25dfeac3438"],
  "steel-water-bottle": ["1602143407151-7111542de6e8", "1548839140-29a749e1cf4d", "1606813907291-d86efa9b94db"],
  "phone-case": ["1601593346740-925612772716", "1556742049-0cfed4f6a45d", "1585060544812-6b45642d76ab"],
  "laptop-backpack": ["1553062407-98eeb64c6a62", "1622560480605-d83c853bc5c3", "1547949003-9792a18a2601"],
  "leather-wallet": ["1627123424574-724758594e93", "1559563458-527698bf5295", "1590380035057-6eccbd547d66"],
  "car-phone-mount": ["1583265171510-bc666429de5c", "1503376780353-7e6692767b70", "1493238792000-8113da705763"],
  "building-blocks": ["1587654780291-39c9404d746b", "1585361111389-36e9b1ac4d03", "1596461404969-9ae70f2830c1"],
  "rc-car": ["1591967006910-9c40956a34c3", "1509114397022-ed747cca3f65", "1520340356584-f9917d1eea6f"],
  "plush-bear": ["1566576912321-d58ddd7a6088", "1559459309-2a2f36a34c6e", "1519823551278-64ac92734fb1"],
  "organic-honey": ["1587049352846-4a222e784d38", "1558642452-9d2a7deb7f62", "1471943311424-646960669fbc"],
  "green-tea": ["1596056820460-9a2eb1c616d8", "1576092768241-dec231879fc3", "1622597467836-f3285f2131b8"],
  "premium-dates": ["1556308815-0d8d9e7d6847", "1591975239467-79db7604cb7d", "1506806732259-39c2d0268443"],
};

const BANNERS: Record<string, string[]> = {
  "hero-shopping": ["1483985988355-763728e1935b", "1607082348824-0a96f2a4b9da"],
  "hero-fashion": ["1441986300917-64674bd600d8", "1489987707025-afc232f7ea0f"],
  "hero-tech": ["1498049794561-7780e7231661", "1518770660439-4636190af475"],
  "promo-sale": ["1607083206968-13611e3d76db", "1445205170230-053b83016050"],
};

const CATEGORIES: Record<string, string[]> = {
  electronics: ["1498049794561-7780e7231661"],
  fashion: ["1441986300917-64674bd600d8"],
  "home-living": ["1513694203232-719a280e022f"],
  "beauty": ["1596462502278-27bfdc403348"],
  sports: ["1517836357463-d25dfeac3438"],
  accessories: ["1524805444758-089113d48a6d"],
  "toys-games": ["1587654780291-39c9404d746b"],
  groceries: ["1542838132-92c53300491e"],
};

async function download(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return false;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 4000) return false; // too small → likely an error page
    writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  }
}

const manifest: Record<string, string[]> = {};

async function main() {
  mkdirSync(`${BASE}/products`, { recursive: true });
  mkdirSync(`${BASE}/banners`, { recursive: true });
  mkdirSync(`${BASE}/categories`, { recursive: true });

  const failures: string[] = [];

  for (const [slug, ids] of Object.entries(PRODUCTS)) {
    const urls: string[] = [];
    let idx = 1;
    for (const id of ids) {
      const dest = `${BASE}/products/${slug}-${idx}.jpg`;
      if (existsSync(dest)) {
        urls.push(`/products/${slug}-${idx}.jpg`);
        idx++;
        continue;
      }
      const w = 800;
      const ok = await download(`https://images.unsplash.com/photo-${id}?w=${w}&q=80&auto=format&fit=crop`, dest);
      if (ok) {
        urls.push(`/products/${slug}-${idx}.jpg`);
        idx++;
      } else {
        failures.push(`${slug}: photo-${id}`);
      }
    }
    manifest[slug] = urls;
  }

  for (const [slug, ids] of Object.entries(BANNERS)) {
    const urls: string[] = [];
    let idx = 1;
    for (const id of ids) {
      const dest = `${BASE}/banners/${slug}-${idx}.jpg`;
      if (existsSync(dest)) {
        urls.push(`/banners/${slug}-${idx}.jpg`);
        idx++;
        continue;
      }
      const ok = await download(`https://images.unsplash.com/photo-${id}?w=1600&q=80&auto=format&fit=crop`, dest);
      if (ok) {
        urls.push(`/banners/${slug}-${idx}.jpg`);
        idx++;
      } else failures.push(`banner ${slug}: photo-${id}`);
    }
    manifest[slug] = urls;
  }

  for (const [slug, ids] of Object.entries(CATEGORIES)) {
    const urls: string[] = [];
    let idx = 1;
    for (const id of ids) {
      const dest = `${BASE}/categories/${slug}-${idx}.jpg`;
      if (existsSync(dest)) {
        urls.push(`/categories/${slug}-${idx}.jpg`);
        idx++;
        continue;
      }
      const ok = await download(`https://images.unsplash.com/photo-${id}?w=600&q=80&auto=format&fit=crop`, dest);
      if (ok) {
        urls.push(`/categories/${slug}-${idx}.jpg`);
        idx++;
      } else failures.push(`category ${slug}: photo-${id}`);
    }
    manifest[slug] = urls;
  }

  writeFileSync("/home/z/my-project/scripts/image-manifest.json", JSON.stringify(manifest, null, 2));
  const total = Object.values(manifest).flat().length;
  console.log(`Downloaded ${total} images. Failures: ${failures.length}`);
  if (failures.length) console.log(failures.join("\n"));
}

main();
