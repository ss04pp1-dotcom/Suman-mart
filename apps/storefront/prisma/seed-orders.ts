/**
 * Seed part 2 — orders, reviews, supplier orders and 30 days of tracking data.
 * Purchases in the tracking data are generated FROM the real orders, so
 * revenue analytics (authoritative = orders) and tracking analytics stay coherent.
 */
import type { PrismaClient } from "@prisma/client";
import { stringifyJSON } from "../src/lib/json";
import { makeOrderNumber } from "../src/lib/format";

interface ProductRef {
  id: string;
  price: number;
  name: string;
  slug: string;
  stock: number;
  supplierExt?: string;
}
interface CustomerRef {
  id: string;
  name: string;
  phone: string | null;
  email: string;
  createdAt: Date;
}

let s = 1337;
function rand(): number {
  s = (s * 1664525 + 1013904223) % 4294967296;
  return s / 4294967296;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

const CAMPAIGNS_BY_SOURCE: Record<string, string[]> = {
  GOOGLE: ["google-search-brand", "google-shopping-feed", "google-display-remarketing"],
  FACEBOOK: ["fb-eid-mega-sale", "fb-electronics-fest", "fb-retarget-30d"],
  INSTAGRAM: ["ig-fashion-drop", "ig-reels-new-arrivals"],
  TIKTOK: ["tt-flash-sale", "tt-unboxing-creators"],
  DIRECT: [],
  OTHER: [],
};

export async function generateOrdersAndTracking(
  db: PrismaClient,
  ctx: {
    products: Record<string, ProductRef>;
    customers: CustomerRef[];
    supplierId: string;
    supplierProductsByExt: Record<string, string>;
  }
) {
  const now = new Date();
  const daysAgo = (d: number, hourJitter = true) => {
    const dt = new Date(now.getTime() - d * 86400_000);
    if (hourJitter) dt.setHours(randInt(8, 22), randInt(0, 59), randInt(0, 59), 0);
    return dt;
  };

  const productRefs = Object.values(ctx.products);
  // Popularity weights: a few bestsellers dominate
  const weightedSlugs = [
    ...Array(14).fill("wireless-earbuds-pro"),
    ...Array(10).fill("smart-watch-series-x"),
    ...Array(8).fill("premium-cotton-tee"),
    ...Array(7).fill("swiftrun-running-sneakers"),
    ...Array(7).fill("vitamin-c-serum-20"),
    ...Array(6).fill("voyager-laptop-backpack-25l"),
    ...Array(5).fill("armor-phone-case"),
    ...Array(5).fill("premium-kimia-dates-1kg"),
    ...Array(5).fill("portable-bluetooth-speaker"),
    ...Array(4).fill("insulated-steel-bottle-1l"),
    ...Array(4).fill("eco-yoga-mat-8mm"),
    ...Array(4).fill("ceramic-mug-set-4"),
    ...Array(3).fill("power-bank-20000mah"),
    ...Array(3).fill("sundarban-organic-honey-500g"),
    ...Array(3).fill("polarized-sunglasses"),
    ...Array(2).fill("leather-crossbody-bag"),
    ...Array(2).fill("nordic-table-lamp"),
    ...Array(2).fill("mechanical-keyboard-rgb"),
    ...Array(2).fill("cuddly-plush-bear-40cm"),
    ...Array(2).fill("genuine-leather-wallet"),
    "heritage-analog-watch", "matte-lipstick-set-5", "speed-jump-rope", "creative-building-blocks-500",
    "foldable-storage-organizer", "vanilla-scented-candle", "throw-pillow-covers-2", "premium-green-tea-250g",
    "wireless-silent-mouse", "gan-fast-charger-65w", "usb-c-hub-7in1", "ionic-hair-dryer-2000w",
  ] as string[];

  const cities = [
    { city: "Dhaka", areas: ["Dhanmondi", "Gulshan", "Mirpur", "Uttara", "Banani", "Mohakhali", "Bashundhara", "Jatrabari", "Wari"] },
    { city: "Chattogram", areas: ["Agrabad", "Khulshi", "Nasirabad", "Halishahar"] },
    { city: "Sylhet", areas: ["Zindabazar", "Amberkhana", "Subhanighat"] },
    { city: "Khulna", areas: ["Sonadanga", "Khalishpur"] },
    { city: "Rajshahi", areas: ["Uposhohor", "Kazla", "Shaheb Bazar"] },
    { city: "Bogura", areas: ["Shatmatha", "Sherpur Road"] },
  ];

  // ── Orders ─────────────────────────────────────────────────────
  console.log("  → orders…");
  const TOTAL_ORDERS = 330;
  const orders: { id: string; orderNumber: string; total: number; createdAt: Date; itemSlugs: string[]; status: string; paymentStatus: string; customerId: string | null }[] = [];

  for (let i = 0; i < TOTAL_ORDERS; i++) {
    // Recent days have more orders (store growth)
    const day = Math.max(0, 30 - Math.floor(Math.pow(rand(), 0.75) * 30));
    const createdAt = daysAgo(day + rand() * 0.9);
    const customer = rand() < 0.55 ? pick(ctx.customers) : null; // 45% guest checkout
    const custRef = customer ?? pick(ctx.customers);
    const name = customer ? customer.name : pick(["Guest Buyer", "Mahmudul Karim", "Sabrina Yasmin", "Ashiq Rahman", "Rima Khatun", "Nazmul Basher"]);
    const phone = customer?.phone ?? `01${randInt(3, 9)}${randInt(10000000, 99999999)}`;

    const lineCount = rand() < 0.6 ? 1 : rand() < 0.85 ? 2 : 3;
    const chosenSlugs = new Set<string>();
    while (chosenSlugs.size < lineCount) chosenSlugs.add(pick(weightedSlugs));

    const items = [...chosenSlugs].map((slug) => {
      const p = ctx.products[slug];
      const qty = rand() < 0.75 ? 1 : rand() < 0.92 ? 2 : 3;
      return { p, qty, total: p.price * qty };
    });

    const subtotal = items.reduce((sum, it) => sum + it.total, 0);
    const useCoupon = rand() < 0.22;
    let discount = 0;
    let couponCode: string | null = null;
    if (useCoupon) {
      if (subtotal >= 4000 && rand() < 0.5) {
        discount = 500;
        couponCode = "SHOPNEST500";
      } else {
        discount = Math.min(300, Math.floor(subtotal * 0.1));
        couponCode = "WELCOME10";
      }
    }
    const freeShip = subtotal - discount >= 2000;
    const shippingTotal = freeShip ? 0 : 60;
    const total = subtotal - discount + shippingTotal;

    // Status by age
    let status: string;
    let paymentStatus: string;
    const paymentMethod = rand() < 0.72 ? "COD" : rand() < 0.6 ? "BKASH" : "NAGAD";
    if (day < 1) {
      status = rand() < 0.6 ? "PENDING" : "CONFIRMED";
      paymentStatus = paymentMethod === "COD" ? "COD_PENDING" : rand() < 0.5 ? "PAID" : "UNPAID";
    } else if (day < 2) {
      status = pick(["CONFIRMED", "PROCESSING", "PROCESSING"]);
      paymentStatus = paymentMethod === "COD" ? "COD_PENDING" : "PAID";
    } else if (day < 4) {
      status = pick(["PROCESSING", "SHIPPED", "SHIPPED"]);
      paymentStatus = paymentMethod === "COD" ? "COD_PENDING" : "PAID";
    } else if (day < 6) {
      status = pick(["SHIPPED", "IN_TRANSIT"]);
      paymentStatus = paymentMethod === "COD" ? "COD_PENDING" : "PAID";
    } else if (day < 8) {
      status = pick(["IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"]);
      paymentStatus = paymentMethod === "COD" ? "COD_PENDING" : "PAID";
    } else {
      status = rand() < 0.9 ? "DELIVERED" : rand() < 0.6 ? "CANCELLED" : "RETURNED";
      paymentStatus =
        status === "DELIVERED" ? "PAID" : status === "CANCELLED" || status === "RETURNED" ? "REFUNDED" : "PAID";
    }

    const loc = pick(cities);
    const address = {
      fullName: name,
      phone,
      line1: `House ${randInt(1, 140)}, Road ${randInt(1, 30)}`,
      line2: rand() < 0.4 ? `Flat ${randInt(1, 12)}${pick(["A", "B", "C"])}` : null,
      city: loc.city,
      area: pick(loc.areas),
      postalCode: `${randInt(1000, 9999)}`,
    };

    const orderNumber = makeOrderNumber(i + 1);
    const order = await db.order.create({
      data: {
        orderNumber,
        customerId: customer?.id ?? null,
        customerName: name,
        customerPhone: phone,
        customerEmail: customer?.email ?? null,
        status,
        paymentStatus,
        paymentMethod,
        subtotal,
        discountTotal: discount,
        shippingTotal,
        total,
        couponCode,
        shippingAddress: stringifyJSON(address),
        purchaseEventId: `purchase_${orderNumber}`,
        estimatedDelivery: new Date(createdAt.getTime() + randInt(2, 5) * 86400_000),
        courier: ["SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"].includes(status)
          ? pick(["Steadfast Courier", "Pathao Courier", "RedX", "Sundarban Courier"])
          : null,
        trackingNumber: ["SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"].includes(status)
          ? `SF${randInt(100000000, 999999999)}`
          : null,
        createdAt,
        items: {
          create: items.map((it) => ({
            productId: it.p.id,
            name: it.p.name,
            sku: `SN-${it.p.slug.toUpperCase().replace(/-/g, "").slice(0, 12)}`,
            imageUrl: `/products/${it.p.slug}-1.jpg`,
            unitPrice: it.p.price,
            quantity: it.qty,
            total: it.total,
            supplierId: it.p.supplierExt ? ctx.supplierId : null,
          })),
        },
        payments: {
          create: {
            method: paymentMethod,
            status: paymentStatus === "PAID" ? "SUCCESS" : "PENDING",
            amount: total,
            transactionId: paymentMethod === "COD" ? null : `TXN${randInt(100000000, 999999999)}`,
          },
        },
      },
    });

    // Status history following the timeline
    const flow = ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"];
    let histStatuses: string[];
    if (status === "CANCELLED") histStatuses = ["PENDING", "CANCELLED"];
    else if (status === "RETURNED") histStatuses = ["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED", "RETURNED"];
    else histStatuses = flow.slice(0, flow.indexOf(status) + 1);
    const stepMs = (now.getTime() - createdAt.getTime()) / (histStatuses.length + 1);
    await db.orderStatusHistory.createMany({
      data: histStatuses.map((st, idx) => ({
        orderId: order.id,
        status: st,
        note: st === "PENDING" ? "Order placed" : `Status updated to ${st.toLowerCase()}`,
        createdBy: idx === 0 ? "system" : "admin:seed",
        createdAt: new Date(createdAt.getTime() + stepMs * (idx + 1)),
      })),
    });

    // Supplier orders for dropshipped items
    const dropItems = items.filter((it) => it.p.supplierExt);
    if (dropItems.length > 0 && status !== "CANCELLED") {
      const itemsTotal = dropItems.reduce((sum, it) => sum + Math.round(it.p.price * 0.65) * it.qty, 0);
      const soStatus =
        status === "PENDING" ? "PENDING" :
        status === "CONFIRMED" || status === "PROCESSING" ? pick(["PLACED", "PROCESSING"]) :
        status === "DELIVERED" || status === "RETURNED" ? "DELIVERED" :
        ["SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY"].includes(status) ? "SHIPPED" : "PLACED";
      await db.supplierOrder.create({
        data: {
          supplierId: ctx.supplierId,
          orderId: order.id,
          externalOrderId: `DWH-SO-${randInt(10000000, 99999999)}`,
          status: soStatus,
          itemsTotal,
          shippingFee: 40,
          total: itemsTotal + 40,
          trackingNumber: soStatus === "SHIPPED" || soStatus === "DELIVERED" ? `SF${randInt(100000000, 999999999)}` : null,
          courier: soStatus === "SHIPPED" || soStatus === "DELIVERED" ? "Steadfast Courier" : null,
          placedAt: new Date(createdAt.getTime() + 3600_000),
          lastCheckedAt: new Date(createdAt.getTime() + 2 * 86400_000),
          createdAt: new Date(createdAt.getTime() + 1800_000),
        },
      });
    }

    orders.push({
      id: order.id,
      orderNumber,
      total,
      createdAt,
      itemSlugs: items.map((it) => it.p.slug),
      status,
      paymentStatus,
      customerId: customer?.id ?? null,
    });
  }

  // Update coupon usage counts from generated orders
  await db.coupon.update({ where: { code: "WELCOME10" }, data: { usageCount: orders.filter((o) => o.status !== "CANCELLED").length ? randInt(80, 140) : 0 } });
  await db.coupon.update({ where: { code: "SHOPNEST500" }, data: { usageCount: randInt(30, 60) } });
  await db.coupon.update({ where: { code: "FREESHIP" }, data: { usageCount: randInt(100, 200) } });

  // Product sold counts + rating placeholders (ratings set after reviews)
  for (const p of productRefs) {
    const sold = orders.reduce((sum, o) => {
      const refs = o.itemSlugs.filter((slug) => slug === p.slug).length;
      return sum + refs;
    }, 0);
    await db.product.update({ where: { id: p.id }, data: { soldCount: sold } });
  }

  // ── Reviews ────────────────────────────────────────────────────
  console.log("  → reviews…");
  const reviewTitles = [
    "Exactly as described", "Great value for money", "Fast delivery, good packaging",
    "Impressive quality", "Worth every taka", "Good but could be better",
    "Highly recommended", "Perfect gift", "Better than expected", "Solid purchase",
  ];
  const reviewComments = [
    "Delivery was quick and the product quality is genuinely good. Packaging was secure and everything arrived in perfect condition. Would order again from ShopNest.",
    "Been using it for two weeks now and totally satisfied. The build quality feels premium and it works exactly as advertised. Highly recommended for the price.",
    "Good product overall. Took one day longer to arrive than expected, but customer support kept me updated the whole time. Happy with the purchase.",
    "This exceeded my expectations. The finish, the weight, the details — everything feels well above this price range. My family loved it too.",
    "Decent quality for the price. Not extraordinary, but definitely reliable. The cash on delivery option made it easy to trust the purchase.",
    "Ordered as a gift and it was a hit. The box arrived neat and the product itself looks premium. Shoutout to the delivery team for handling it carefully.",
    "Works perfectly so far. Setup took two minutes and it has been flawless since. Battery life matches the description, which is rare these days.",
    "Really happy with this. Compared prices across several shops and ShopNest had the best deal with the fastest delivery. Smooth experience overall.",
  ];
  const reviewNames = ["Ayesha S.", "Mehedi H.", "Sadia I.", "Rafiq U.", "Nabila C.", "Imran K.", "Tasnim R.", "Jahid H.", "Sharmin A.", "Fahim S.", "Rumana H.", "Arif M.", "Sumaiya N.", "Ridwan K."];

  const reviewedProducts = productRefs.filter(() => rand() < 0.8);
  let reviewCount = 0;
  // One review per (product, customer) — mirrors the DB unique constraint
  const usedPairs = new Set<string>();
  for (const p of reviewedProducts) {
    const n = randInt(1, 5);
    for (let i = 0; i < n; i++) {
      const rating = rand() < 0.62 ? 5 : rand() < 0.6 ? 4 : rand() < 0.7 ? 3 : rand() < 0.5 ? 2 : 1;
      const status = rand() < 0.82 ? "APPROVED" : rand() < 0.5 ? "PENDING" : "HIDDEN";
      let linkedCustomer = rand() < 0.4 ? pick(ctx.customers) : null;
      if (linkedCustomer) {
        const key = `${p.id}:${linkedCustomer.id}`;
        if (usedPairs.has(key)) {
          linkedCustomer = null; // this customer already reviewed the product
        } else {
          usedPairs.add(key);
        }
      }
      await db.review.create({
        data: {
          productId: p.id,
          customerId: linkedCustomer?.id ?? null,
          authorName: linkedCustomer ? linkedCustomer.name : pick(reviewNames),
          rating,
          title: pick(reviewTitles),
          comment: pick(reviewComments),
          verifiedPurchase: Boolean(linkedCustomer),
          status,
          isFeatured: status === "APPROVED" && rating === 5 && rand() < 0.15,
          createdAt: daysAgo(randInt(1, 45)),
        },
      });
      reviewCount++;
    }
  }

  // Recompute product ratings from approved reviews
  const approved = await db.review.groupBy({
    by: ["productId"],
    where: { status: "APPROVED" },
    _avg: { rating: true },
    _count: { rating: true },
  });
  for (const agg of approved) {
    await db.product.update({
      where: { id: agg.productId },
      data: {
        rating: Math.round((agg._avg.rating ?? 0) * 10) / 10,
        reviewCount: agg._count.rating,
      },
    });
  }

  // Product relations: RELATED (same-category suggestions) + FBT (co-purchase)
  console.log("  → recommendations…");
  const bySlug = ctx.products;
  const relatedPairs: [string, string][] = [
    ["wireless-earbuds-pro", "smart-watch-series-x"],
    ["wireless-earbuds-pro", "portable-bluetooth-speaker"],
    ["smart-watch-series-x", "heritage-analog-watch"],
    ["swiftrun-running-sneakers", "classic-denim-jacket"],
    ["swiftrun-running-sneakers", "eco-yoga-mat-8mm"],
    ["premium-cotton-tee", "classic-denim-jacket"],
    ["mechanical-keyboard-rgb", "wireless-silent-mouse"],
    ["mechanical-keyboard-rgb", "usb-c-hub-7in1"],
    ["gan-fast-charger-65w", "power-bank-20000mah"],
    ["vitamin-c-serum-20", "gentle-facial-cleanser"],
    ["ceramic-mug-set-4", "vanilla-scented-candle"],
    ["voyager-laptop-backpack-25l", "genuine-leather-wallet"],
    ["sundarban-organic-honey-500g", "premium-green-tea-250g"],
    ["armor-phone-case", "magnetic-car-phone-mount"],
    ["nordic-table-lamp", "throw-pillow-covers-2"],
  ];
  // FBT from real co-purchase in seeded orders
  const pairCounts = new Map<string, number>();
  for (const o of orders) {
    const slugs = o.itemSlugs;
    for (let i = 0; i < slugs.length; i++) {
      for (let j = i + 1; j < slugs.length; j++) {
        const key = [slugs[i], slugs[j]].sort().join("|");
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const topPairs = [...pairCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const fbtPairs = topPairs.map(([k]) => k.split("|") as [string, string]);

  for (const [a, b] of relatedPairs) {
    if (!bySlug[a] || !bySlug[b]) continue;
    await db.productRelation.createMany({
      data: [
        { productId: bySlug[a].id, relatedProductId: bySlug[b].id, type: "RELATED", sortOrder: 1 },
        { productId: bySlug[b].id, relatedProductId: bySlug[a].id, type: "RELATED", sortOrder: 1 },
      ],
      
    });
  }
  for (const [a, b] of fbtPairs) {
    if (!bySlug[a] || !bySlug[b]) continue;
    await db.productRelation.createMany({
      data: [
        { productId: bySlug[a].id, relatedProductId: bySlug[b].id, type: "FBT", sortOrder: 1 },
        { productId: bySlug[b].id, relatedProductId: bySlug[a].id, type: "FBT", sortOrder: 1 },
      ],
      
    });
  }

  // ── Tracking sessions & events ─────────────────────────────────
  console.log("  → tracking sessions & events…");
  const devices: [string, number][] = [["MOBILE", 0.68], ["DESKTOP", 0.27], ["TABLET", 0.05]];  const browsersByDevice: Record<string, [string, number][]> = {
    MOBILE: [["Chrome", 0.6], ["Safari", 0.25], ["Samsung Internet", 0.15]],
    DESKTOP: [["Chrome", 0.62], ["Edge", 0.15], ["Firefox", 0.13], ["Safari", 0.1]],
    TABLET: [["Safari", 0.7], ["Chrome", 0.3]],
  };
  const osByDevice: Record<string, [string, number][]> = {
    MOBILE: [["Android", 0.72], ["iOS", 0.28]],
    DESKTOP: [["Windows", 0.7], ["macOS", 0.2], ["Linux", 0.1]],
    TABLET: [["iOS", 0.75], ["Android", 0.25]],
  };
  const countries: [string, number][] = [
    ["BD|Dhaka", 0.78], ["BD|Chattogram", 0.08], ["BD|Sylhet", 0.04],
    ["IN|West Bengal", 0.03], ["US|New York", 0.03], ["GB|London", 0.02], ["MY|Kuala Lumpur", 0.02],
  ];
  const sources: [string, number][] = [["DIRECT", 0.42], ["GOOGLE", 0.24], ["FACEBOOK", 0.16], ["INSTAGRAM", 0.1], ["TIKTOK", 0.06], ["OTHER", 0.02]];
  function weighted(entries: [string, number][]): string {
    const total = entries.reduce((s, e) => s + e[1], 0);
    let r = rand() * total;
    for (const e of entries) {
      r -= e[1];
      if (r <= 0) return e[0];
    }
    return entries[0][0];
  }

  // Purchases per day must match orders per day (for coherent funnel/revenue)
  const ordersByDay = new Map<string, number>();
  for (const o of orders) {
    const key = o.createdAt.toISOString().slice(0, 10);
    ordersByDay.set(key, (ordersByDay.get(key) ?? 0) + 1);
  }

  const eventBuffer: {
    eventId: string; sessionId: string; name: string; url?: string | null; productId?: string | null;
    productName?: string | null; searchQuery?: string | null; searchResults?: number | null; value?: number | null;
    quantity?: number | null; source: string; metaStatus?: string | null; ga4Status?: string | null; tiktokStatus?: string | null;
    device?: string | null; browser?: string | null; os?: string | null; country?: string | null; trafficSource?: string | null; campaign?: string | null;
    createdAt: Date;
  }[] = [];

  const searchQueries = [
    "wireless earbuds", "smart watch", "power bank", "yoga mat", "backpack",
    "vitamin c serum", "sneakers", "denim jacket", "bluetooth speaker", "honey",
    "phone case", "lipstick", "keyboard", "sunglasses", "water bottle", "dates",
    "watch for gift", "earbuds under 3000", "keyboard mechanical", "tea",
  ];

  let sessionCount = 0;
  const totalSessions = 2600;
  interface SessionRef {
    id: string;
    device: string;
    browser: string;
    os: string;
    country: string;
    source: string;
    campaign: string | null;
    createdAt: Date;
  }
  const sessionIds: SessionRef[] = [];

  for (let i = 0; i < totalSessions; i++) {
    // More traffic on recent days (growth) with weekend bumps
    const day = Math.max(0, 30 - Math.floor(Math.pow(rand(), 0.8) * 30));
    const firstSeen = new Date(now.getTime() - day * 86400_000 - randInt(0, 20) * 3600_000);
    if (firstSeen < new Date(now.getTime() - 30 * 86400_000)) continue;

    const device = weighted(devices);
    const browser = weighted(browsersByDevice[device]);
    const os = weighted(osByDevice[device]);
    const [country, region] = (weighted(countries) as string).split("|");
    const source = weighted(sources);
    const campaign = CAMPAIGNS_BY_SOURCE[source] ? pick(CAMPAIGNS_BY_SOURCE[source]) || null : null;
    const isReturning = rand() < 0.18;

    const session = await db.trackingSession.create({
      data: {
        sessionKey: `seed-${i.toString(36)}-${Math.floor(rand() * 1e9).toString(36)}`,
        device,
        browser,
        os,
        country,
        region,
        source,
        medium: source === "DIRECT" ? "none" : source === "GOOGLE" ? "cpc" : "referral",
        campaign,
        referrer: source === "DIRECT" ? null : source === "GOOGLE" ? "https://google.com" : `https://${source.toLowerCase()}.com`,
        landingPath: pick(["/", "/products", "/products?category=electronics", "/products?category=fashion", "/"]),
        pageViewCount: randInt(1, 6),
        isReturning,
        firstSeenAt: firstSeen,
        lastSeenAt: new Date(firstSeen.getTime() + randInt(2, 35) * 60_000),
      },
    });
    sessionIds.push({ id: session.id, device, browser, os, country, source, campaign, createdAt: firstSeen });
    sessionCount++;

    // Consent for ~72% of sessions
    if (rand() < 0.72) {
      const choice = rand() < 0.55 ? "ACCEPT_ALL" : rand() < 0.55 ? "ESSENTIAL_ONLY" : rand() < 0.5 ? "CUSTOM" : "REJECTED";
      await db.cookieConsent.create({
        data: {
          sessionId: session.id,
          choice,
          analytics: choice === "ACCEPT_ALL" || (choice === "CUSTOM" && rand() < 0.8),
          marketing: choice === "ACCEPT_ALL",
          createdAt: firstSeen,
        },
      });
    }

    // Funnel events
    const t = (offsetSec: number) => new Date(firstSeen.getTime() + offsetSec * 1000);
    const evId = () => `seed-evt-${i.toString(36)}-${Math.floor(rand() * 1e12).toString(36)}`;
    const base = { sessionId: session.id, source: "BROWSER", device, browser, os, country, trafficSource: source, campaign };

    eventBuffer.push({ ...base, eventId: evId(), name: "PageView", url: "/", createdAt: t(0) });

    // ViewContent
    const viewCount = rand() < 0.75 ? randInt(1, 4) : 0;
    const viewedSlugs: string[] = [];
    for (let v = 0; v < viewCount; v++) {
      const p = bySlug[pick(weightedSlugs)];
      viewedSlugs.push(p.slug);
      eventBuffer.push({
        ...base, eventId: evId(), name: "ViewContent", url: `/products/${p.slug}`,
        productId: p.id, productName: p.name, createdAt: t(30 + v * randInt(25, 90)),
      });
    }

    // Search
    if (rand() < 0.3) {
      const q = pick(searchQueries);
      eventBuffer.push({
        ...base, eventId: evId(), name: "Search", url: `/products?q=${encodeURIComponent(q)}`,
        searchQuery: q, searchResults: randInt(0, 24), createdAt: t(randInt(20, 120)),
      });
    }

    // AddToCart
    if (viewedSlugs.length > 0 && rand() < 0.34) {
      const slug = pick(viewedSlugs);
      const p = bySlug[slug];
      eventBuffer.push({
        ...base, eventId: evId(), name: "AddToCart", url: `/products/${slug}`,
        productId: p.id, productName: p.name, value: p.price, quantity: 1, createdAt: t(randInt(60, 200)),
      });
      // ViewCart
      if (rand() < 0.8) {
        eventBuffer.push({ ...base, eventId: evId(), name: "ViewCart", url: "/cart", value: p.price, createdAt: t(randInt(120, 300)) });
      }
      // InitiateCheckout
      if (rand() < 0.55) {
        eventBuffer.push({ ...base, eventId: evId(), name: "InitiateCheckout", url: "/checkout", value: p.price, createdAt: t(randInt(150, 400)) });
        // AddPaymentInfo
        if (rand() < 0.85) {
          eventBuffer.push({ ...base, eventId: evId(), name: "AddPaymentInfo", url: "/checkout", value: p.price, createdAt: t(randInt(180, 500)) });
        }
      }
    }
  }

  // Purchases: assign to sessions per day to match real orders (browser + server copies with shared eventId)
  const sessionByDay = new Map<string, SessionRef[]>();
  for (const s of sessionIds) {
    const key = s.createdAt.toISOString().slice(0, 10);
    const arr = sessionByDay.get(key) ?? [];
    arr.push(s);
    sessionByDay.set(key, arr);
  }
  let purchasePairs = 0;
  for (const o of orders) {
    if (o.status === "CANCELLED") continue;
    const dayKey = o.createdAt.toISOString().slice(0, 10);
    const pool = sessionByDay.get(dayKey);
    if (!pool || pool.length === 0) continue;
    const sess = pick(pool);
    const firstItem = bySlug[o.itemSlugs[0]];
    const eventId = `purchase_${o.orderNumber}`;
    const at = o.createdAt;
    const base = { sessionId: sess.id, productId: firstItem?.id, productName: firstItem?.name, value: o.total, quantity: o.itemSlugs.length, url: `/order-success/${o.orderNumber}`, device: sess.device, browser: sess.browser, os: sess.os, country: sess.country, trafficSource: sess.source, campaign: sess.campaign };
    // Browser copy
    eventBuffer.push({ ...base, name: "Purchase", eventId, source: "BROWSER", metaStatus: "SKIPPED", ga4Status: "SKIPPED", tiktokStatus: "SKIPPED", createdAt: at });
    // Server copy (same eventId → dedup)
    eventBuffer.push({ ...base, name: "Purchase", eventId, source: "SERVER", metaStatus: "SKIPPED", ga4Status: "SKIPPED", tiktokStatus: "SKIPPED", createdAt: at });
    purchasePairs++;
  }

  console.log(`  → inserting ${eventBuffer.length} events (${sessionCount} sessions, ${purchasePairs} dedup purchase pairs)…`);
  // Bulk insert in chunks
  const CHUNK = 500;
  for (let i = 0; i < eventBuffer.length; i += CHUNK) {
    const chunk = eventBuffer.slice(i, i + CHUNK).map((e) => ({
      eventId: e.eventId,
      sessionId: e.sessionId,
      name: e.name,
      url: e.url ?? null,
      productId: e.productId ?? null,
      productName: e.productName ?? null,
      searchQuery: e.searchQuery ?? null,
      searchResults: e.searchResults ?? null,
      value: e.value ?? null,
      quantity: e.quantity ?? null,
      source: e.source,
      metaStatus: e.metaStatus ?? null,
      ga4Status: e.ga4Status ?? null,
      tiktokStatus: e.tiktokStatus ?? null,
      device: e.device ?? null,
      browser: e.browser ?? null,
      os: e.os ?? null,
      country: e.country ?? null,
      trafficSource: e.trafficSource ?? null,
      campaign: e.campaign ?? null,
      createdAt: e.createdAt,
    }));
    await db.trackingEvent.createMany({ data: chunk });
  }

  // Update product view counts from ViewContent events
  await db.$executeRawUnsafe(`
    UPDATE Product SET viewCount = (
      SELECT COUNT(*) FROM TrackingEvent
      WHERE TrackingEvent.productId = Product.id AND TrackingEvent.name = 'ViewContent'
    )
  `);

  // ── Notifications & audit trail ────────────────────────────────
  await db.notification.createMany({
    data: [
      { type: "ORDER", title: `New order ${orders[orders.length - 1].orderNumber}`, message: "A new order was placed and is awaiting confirmation.", link: `/admin/orders/${orders[orders.length - 1].id}`, createdAt: daysAgo(0.05) },
      { type: "STOCK", title: "Low stock: Adjustable Dumbbell Pair", message: "Only 3 units remaining (threshold 5).", link: "/admin/products", createdAt: daysAgo(0.3) },
      { type: "STOCK", title: "Low stock: Ionic Hair Dryer 2000W", message: "Only 2 units remaining (threshold 6).", link: "/admin/products", createdAt: daysAgo(0.6) },
      { type: "REVIEW", title: "New review awaiting approval", message: "A customer reviewed Wireless Earbuds Pro.", link: "/admin/reviews", createdAt: daysAgo(1.1) },
      { type: "SUPPLIER", title: "Partial sync — Dhaka Wholesale Hub", message: "2 items failed: supplier API timeout.", link: "/admin/suppliers", isRead: true, createdAt: daysAgo(1.8) },
    ],
  });
  const admin0 = await db.admin.findFirst({ where: { role: "SUPER_ADMIN" } });
  if (admin0) {
    await db.auditLog.createMany({
      data: [
        { adminId: admin0.id, action: "admin.login", entity: "admin", entityId: admin0.id, details: stringifyJSON({ email: admin0.email }), createdAt: daysAgo(0.4) },
        { adminId: admin0.id, action: "product.updated", entity: "product", details: stringifyJSON({ name: "Wireless Earbuds Pro", fields: ["price"] }), createdAt: daysAgo(0.9) },
        { adminId: admin0.id, action: "settings.updated", entity: "settings", details: stringifyJSON({ key: "shipping" }), createdAt: daysAgo(2.1) },
        { adminId: admin0.id, action: "supplier.sync", entity: "supplier", details: stringifyJSON({ supplier: "Dhaka Wholesale Hub", type: "PRODUCTS" }), createdAt: daysAgo(0.2) },
      ],
    });
  }

  console.log(`✅ Seed complete: ${TOTAL_ORDERS} orders, ${reviewCount} reviews, ${sessionCount} sessions, ${eventBuffer.length} tracking events.`);
}
