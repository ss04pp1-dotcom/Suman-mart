// E2E driver: round-5 audit verification on the production standalone
// builds — THREE-TIER topology (Workers API :8787 + storefront :3111 +
// admin app :3112, all booted via tests/e2e/boot.sh).
//
// Verifies, against the REAL servers (booted with E2E_RESEND_API_KEY set to
// a deliberately invalid key — a simulated Resend outage):
//   Phase A — the guest-OTP endpoint reports delivery failures honestly
//             (sent:false) and, after 3 consecutive failures, the OTP gate
//             relaxes AUTOMATICALLY (no env hand-editing); a guest with an
//             email but no code can still order during the outage.
//   Phase B — a guest with NO email orders without any code (optional email).
//   Phase C — admin payment verification: smsVerified enforced server-side
//             (422 without the tick), the tick is audited as
//             payment.sms_verified with the acting admin's identity, and the
//             combined save PAID+CANCELLED keeps the TrxID LOCKED (round-5
//             ordering) while a plain cancel still releases it (round 4).
//   Phase D — the storefront checkout page renders the optional-email UI.
//
// SAFEGUARDS (same family as the other e2e helpers): refuses in production,
// requires E2E_ROUND5=1, and only ever reads the LOCAL D1 (via wrangler —
// the remote production database is unreachable from this driver). The
// admin password is generated randomly per run — nothing is committed.
//
// NOTE: run immediately after tests/e2e/boot.sh — the outage breaker lives in
// the API server process's memory and must start fresh. TrxIDs are unique per
// run, so re-running against the same sandbox D1 is safe.
import { resolve } from "node:path";
import { d1, guestOtpHashFor, sqlDate } from "./d1";

const REPO_ROOT = resolve(import.meta.dir, "../../../..");
const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3111";
const ADMIN_BASE = process.env.E2E_ADMIN_BASE ?? "http://127.0.0.1:3112";

function bail(reason: string): never {
  console.error(`[e2e-round5] REFUSING to run: ${reason}`);
  process.exit(1);
}
if (process.env.NODE_ENV === "production") bail("NODE_ENV=production — dev harness only.");
if (process.env.E2E_ROUND5 !== "1") bail("set E2E_ROUND5=1 to confirm you are driving the dev sandbox server.");

// ── tiny assertion harness ─────────────────────────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✘ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ApiResult {
  res: Response;
  data: any;
  text: string;
}
async function callApi(base: string, path: string, init?: RequestInit & { json?: unknown; cookie?: string }): Promise<ApiResult> {
  const { json, cookie, ...rest } = init ?? {};
  const res = await fetch(`${base}${path}`, {
    ...rest,
    headers: {
      // Origin must match the app being called — the backend's same-origin
      // CSRF check compares it against the proxy's x-forwarded-host.
      Origin: base,
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...((rest.headers as Record<string, string>) ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : (rest.body as string | undefined),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { res, data, text };
}
async function api(path: string, init?: RequestInit & { json?: unknown; cookie?: string }): Promise<ApiResult> {
  return callApi(BASE, path, init);
}
async function adminApi(path: string, init?: RequestInit & { json?: unknown; cookie?: string }): Promise<ApiResult> {
  return callApi(ADMIN_BASE, path, init);
}

async function waitOutbox(to: string, subjectPart: string, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = d1(`SELECT "subject" FROM "MailOutbox" WHERE "toEmail" = '${to}'`);
    if (rows.some((r) => String(r.subject ?? "").includes(subjectPart))) return true;
    await sleep(250);
  }
  return false;
}

// ── fixtures ───────────────────────────────────────────────────────────
const A_EMAIL = "round5.a@shopnest.com"; // OTP-verified buyer
const D_EMAIL = "round5.d@shopnest.com"; // email given, no code (outage fallback)
// Unique per-run TrxIDs — a re-run must not collide with the previous run's
// still-locked rows (the unique index is exactly what we are testing).
const RUN = Date.now().toString(36).toUpperCase().slice(-6);
const TRX_A = `R5${RUN}A001`; // OTP-verified order → later marked PAID
const TRX_B = `R5${RUN}B001`; // outage-fallback order → later PAID+CANCELLED (locked)
const TRX_C = `R5${RUN}C001`; // no-email order → later plain-cancelled (released)
const ADDRESS = {
  fullName: "E2E Round5",
  phone: "01712345678",
  line1: "12 Test Road",
  line2: null,
  city: "Dhaka",
  area: null,
  postalCode: null,
};
function guestCheckout(productId: string, opts: { email?: string | null; code?: string | null; trxId: string }) {
  return {
    items: [{ productId, variantId: null, quantity: 1 }],
    couponCode: null,
    address: ADDRESS,
    customerNote: null,
    customerEmail: opts.email ?? null,
    guestEmailOtp: opts.code ?? null,
    paymentTrxId: opts.trxId,
    paymentMethod: "BKASH" as const,
  };
}

// ── preflight ──────────────────────────────────────────────────────────
console.log("── Preflight ──");
const pre = await api("/api/settings/public");
check("server is up and answering JSON", pre.data?.success === true, pre.text.slice(0, 120));
if (pre.data?.success !== true) {
  process.exit(1);
}
const productRow = d1(`SELECT "id", "name" FROM "Product" WHERE "isActive" = 1 AND "stock" >= 10 LIMIT 1`)[0];
if (!productRow) {
  console.error("  ✘ no active product with stock — seed the sandbox first");
  process.exit(1);
}
const product = { id: String(productRow.id), name: String(productRow.name) };
console.log(`  using product: ${product.name}`);

// Fixed-window buckets persist in db/ratelimit.db — previous runs (and the
// boot warm-up) would otherwise eat this run's checkout/OTP budget and fail
// the driver with 429s (round-4 E2E hit exactly this). Clear them through
// the guarded helper, same as the operator would.
const rl = Bun.spawnSync(["bun", "tests/e2e/rl-clear.ts"], {
  cwd: resolve(REPO_ROOT, "apps/storefront"),
  env: { ...process.env, E2E_RL_CLEAR: "1" },
  stdout: "pipe",
  stderr: "pipe",
});
const rlOut = typeof rl.stdout === "string" ? rl.stdout : new TextDecoder().decode(rl.stdout as Uint8Array);
check("rate-limit buckets cleared for this run", /buckets cleared/.test(rlOut), rlOut.slice(0, 160));

// ────────────────────────────────────────────────────────────────────────
// Phase A — provider outage: honest reporting + automatic relaxation.
// The server was booted with an INVALID Resend key, so every send fails.
// Failure count: A1 (OTP) = 1, A2-confirmation = 2, A3 (OTP) = 3 → breaker.
// ────────────────────────────────────────────────────────────────────────
console.log("\n── Phase A: provider outage — honest reporting + automatic relaxation (round 5) ──");

let r = await api("/api/checkout/guest-otp", { method: "POST", json: { email: A_EMAIL } });
check(
  "A1 OTP request reports sent:false honestly (PROVIDER_UNAVAILABLE), not a fake sent:true",
  r.data?.success === true && r.data?.data?.sent === false && r.data?.data?.reason === "PROVIDER_UNAVAILABLE",
  r.text.slice(0, 160)
);
check("A1 the failed delivery is recorded in the outbox", await waitOutbox(A_EMAIL, "checkout code"));
const otpOutboxRow = d1(`SELECT "status", "provider" FROM "MailOutbox" WHERE "toEmail" = '${A_EMAIL}' ORDER BY "createdAt" DESC LIMIT 1`)[0];
check("A1 outbox row status FAILED via provider resend", otpOutboxRow?.status === "FAILED" && otpOutboxRow?.provider === "resend");

// Inject a KNOWN code (the real one is in an undeliverable mail) and verify
// the OTP-gated checkout path still works while the provider is failing.
{
  const codeHash = await guestOtpHashFor(A_EMAIL, "314159");
  d1(
    `INSERT INTO "GuestEmailOtp" ("id", "email", "codeHash", "expiresAt", "attempts", "createdAt") ` +
      `VALUES ('${crypto.randomUUID()}', '${A_EMAIL}', '${codeHash}', ${sqlDate(Date.now() + 10 * 60_000)}, 0, ${sqlDate()})`
  );
}
r = await api("/api/checkout", { method: "POST", json: guestCheckout(product.id, { email: A_EMAIL, code: "314159", trxId: TRX_A }) });
check("A2 guest bKash order with email + OTP code succeeds", r.data?.success === true, r.text.slice(0, 200));
const orderA: string = r.data?.data?.orderNumber;
check("A2 confirmation-mail failure recorded in the outbox (breaker failure #2)", await waitOutbox(A_EMAIL, `Order ${orderA} confirmed`));
const orderARow = d1(`SELECT "id", "total", "customerEmail" FROM "Order" WHERE "orderNumber" = '${orderA}'`)[0];
check("A2 order stored with the guest email", orderARow?.customerEmail === A_EMAIL);
const payA0 = d1(`SELECT "status", "transactionId" FROM "Payment" WHERE "orderId" = '${orderARow.id}'`)[0];
check("A2 payment row PENDING with the buyer's original TrxID", payA0?.status === "PENDING" && payA0?.transactionId === TRX_A);

r = await api("/api/checkout/guest-otp", { method: "POST", json: { email: "round5.b@shopnest.com" } });
check("A3 third consecutive failure also reported sent:false", r.data?.data?.sent === false, r.text.slice(0, 160));

r = await api("/api/checkout/guest-otp", { method: "POST", json: { email: "round5.c@shopnest.com" } });
check(
  "A4 after 3 consecutive failures the gate relaxes AUTOMATICALLY (OTP_NOT_REQUIRED)",
  r.res.status === 400 && r.data?.code === "OTP_NOT_REQUIRED",
  r.text.slice(0, 160)
);

r = await api("/api/settings/public");
check("A5 public flag guestEmailVerification=false during the detected outage", r.data?.data?.guestEmailVerification === false);

r = await api("/api/checkout", { method: "POST", json: guestCheckout(product.id, { email: D_EMAIL, code: null, trxId: TRX_B }) });
check(
  "A6 guest WITH email but NO code orders fine during the outage (no more deadlock — round 5)",
  r.data?.success === true,
  r.text.slice(0, 200)
);
const orderD: string = r.data?.data?.orderNumber;
// Wait for A6's confirmation mail to land in the outbox BEFORE counting —
// otherwise it appears inside Phase B's window and breaks the delta assert.
// (Subject must name THIS run's order — a previous run's rows also match a
// bare "confirmed" and would make the wait return against a stale row.)
check("A6 confirmation-mail failure recorded (outbox)", await waitOutbox(D_EMAIL, `Order ${orderD} confirmed`));

// ────────────────────────────────────────────────────────────────────────
// Phase B — guest with NO email (round-5 optional email).
// ────────────────────────────────────────────────────────────────────────
console.log("\n── Phase B: guest without an email (round-5 optional email) ──");

const outboxBefore = Number(d1(`SELECT COUNT(*) AS n FROM "MailOutbox"`)[0]?.n ?? 0);
r = await api("/api/checkout", { method: "POST", json: guestCheckout(product.id, { email: null, code: null, trxId: TRX_C }) });
check("B1 guest bKash order with NO email succeeds", r.data?.success === true, r.text.slice(0, 200));
const orderC: string = r.data?.data?.orderNumber;
const orderCRow = d1(`SELECT "id", "total", "customerEmail" FROM "Order" WHERE "orderNumber" = '${orderC}'`)[0];
check("B1 order stored with customerEmail null", orderCRow?.customerEmail == null);
const payC0 = d1(`SELECT "status", "transactionId" FROM "Payment" WHERE "orderId" = '${orderCRow.id}'`)[0];
check("B1 payment row PENDING with the buyer's TrxID", payC0?.status === "PENDING" && payC0?.transactionId === TRX_C);
await sleep(1500); // give any (wrongly attempted) mail a moment to appear
check(
  "B1 no confirmation mail was even attempted (outbox untouched)",
  Number(d1(`SELECT COUNT(*) AS n FROM "MailOutbox"`)[0]?.n ?? -1) === outboxBefore
);

// ────────────────────────────────────────────────────────────────────────
// Phase C — admin payment verification + cancel/lock semantics.
// ────────────────────────────────────────────────────────────────────────
console.log("\n── Phase C: admin payment verification + cancel/lock semantics (round 5) ──");

// Random per-run admin password (never committed) via the guarded helper.
const adminPassword = `R5-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
const reset = Bun.spawnSync(["bun", "tests/e2e/admin-pw.ts"], {
  cwd: resolve(REPO_ROOT, "apps/storefront"),
  env: { ...process.env, E2E_RESET_ADMIN: "1", E2E_ADMIN_PASSWORD: adminPassword },
  stdout: "pipe",
  stderr: "pipe",
});
const resetOut = typeof reset.stdout === "string" ? reset.stdout : new TextDecoder().decode(reset.stdout as Uint8Array);
const resetErr = typeof reset.stderr === "string" ? reset.stderr : new TextDecoder().decode(reset.stderr as Uint8Array);
check("C0 admin password reset helper ran", /sandbox admin password set/.test(resetOut), resetErr.slice(0, 200));

r = await adminApi("/api/admin/auth/login", { method: "POST", json: { email: "admin@shopnest.com", password: adminPassword } });
check("C0 admin login (through the admin app's proxy)", r.data?.success === true, r.text.slice(0, 200));
const setCookies = r.res.headers.getSetCookie?.() ?? [];
const adminCookie = setCookies.map((c) => c.split(";")[0]).find((c) => c.startsWith("sn_admin=")) ?? "";
check("C0 admin session cookie captured", adminCookie.length > 0);
const admin = (method: string, path: string, json?: unknown) => adminApi(path, { method, json, cookie: adminCookie });

// C1/C2 — order A: verification requires the tick; the tick is audited.
r = await admin("PUT", `/api/admin/orders/${orderA}`, { paymentStatus: "PAID" });
check("C1 PAID without smsVerified → 422 SMS_MATCH_REQUIRED", r.res.status === 422 && r.data?.code === "SMS_MATCH_REQUIRED", r.text.slice(0, 160));

r = await admin("PUT", `/api/admin/orders/${orderA}`, { paymentStatus: "PAID", smsVerified: true });
check("C2 PAID with smsVerified accepted", r.data?.success === true, r.text.slice(0, 200));
const payA1 = d1(`SELECT "status", "transactionId" FROM "Payment" WHERE "orderId" = '${orderARow.id}'`)[0];
check("C2 payment flipped to SUCCESS, original TrxID preserved", payA1?.status === "SUCCESS" && payA1?.transactionId === TRX_A);

const auditRow = d1(`SELECT "details" FROM "AuditLog" WHERE "action" = 'payment.sms_verified' ORDER BY "createdAt" DESC LIMIT 1`)[0];
const auditDetails = auditRow ? JSON.parse(String(auditRow.details ?? "{}")) : {};
check(
  "C2b the tick is AUDITED: who confirmed, which TrxID, which amount, when",
  auditRow != null &&
    auditDetails.transactionId === TRX_A &&
    String(auditDetails.amount) === String(orderARow.total) &&
    String(auditDetails.smsConfirmedBy ?? "").includes("admin@shopnest.com") &&
    Boolean(auditDetails.smsConfirmedAt),
  JSON.stringify(auditDetails).slice(0, 200)
);

// C3/C4 — order D: combined PAID+CANCELLED (money arrived, refunded outside).
r = await admin("PUT", `/api/admin/orders/${orderD}`, {
  status: "CANCELLED",
  paymentStatus: "PAID",
  smsVerified: true,
  note: "money arrived, refunded via the bKash app",
});
check("C3 combined PAID+CANCELLED save accepted", r.data?.success === true, r.text.slice(0, 200));
const orderDRow = d1(`SELECT "id", "status", "paymentStatus" FROM "Order" WHERE "orderNumber" = '${orderD}'`)[0];
const payD1 = d1(`SELECT "status", "transactionId" FROM "Payment" WHERE "orderId" = '${orderDRow.id}'`)[0];
check(
  "C3 payment SUCCESS with the ORIGINAL TrxID — NOT released (round-5 ordering)",
  payD1?.status === "SUCCESS" && payD1?.transactionId === TRX_B && !payD1.transactionId.includes("-RELEASED-")
);
check("C3 order CANCELLED with paymentStatus PAID", orderDRow?.status === "CANCELLED" && orderDRow?.paymentStatus === "PAID");

r = await api("/api/checkout", { method: "POST", json: guestCheckout(product.id, { email: null, code: null, trxId: TRX_B }) });
check("C4 the verified TrxID stays LOCKED — a new order with it is rejected 409", r.res.status === 409 && r.data?.code === "TRXID_ALREADY_USED", r.text.slice(0, 160));

// C5/C6 — order C: plain cancel (no money arrived) still releases the claim.
r = await admin("PUT", `/api/admin/orders/${orderC}`, { status: "CANCELLED", note: "buyer never paid" });
check("C5 plain cancel accepted", r.data?.success === true, r.text.slice(0, 200));
const payC1 = d1(`SELECT "status", "transactionId" FROM "Payment" WHERE "orderId" = '${orderCRow.id}'`)[0];
check("C5 unverified TrxID released (renamed -RELEASED-<orderNumber>)", payC1?.transactionId === `${TRX_C}-RELEASED-${orderC}`);

r = await api("/api/checkout", { method: "POST", json: guestCheckout(product.id, { email: null, code: null, trxId: TRX_C }) });
check("C6 the released TrxID funds a NEW order (no more 409)", r.data?.success === true, r.text.slice(0, 200));

// ────────────────────────────────────────────────────────────────────────
// Phase D — storefront checkout page renders the optional-email UI.
// ────────────────────────────────────────────────────────────────────────
console.log("\n── Phase D: storefront + admin UI shipped to the browser ──");
const page = await fetch(`${BASE}/checkout`);
const html = await page.text();
check("D1 /checkout renders 200", page.status === 200);
// The form sits behind <Suspense> (it hydrates client-side), so assert on what
// actually SHIPPED to the browser: grep the page's JS chunks — string literals
// survive minification, so the new optional-email UI copy is findable verbatim.
const chunkUrls = [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
let bundle = "";
for (const u of chunkUrls) bundle += await fetch(`${BASE}${u}`).then((x) => x.text());
check("D1 email field labelled optional (shipped bundle)", bundle.includes("Email (optional"));
check("D1 OTP code input shipped", bundle.includes("6-digit code from your email"));
check("D1 honest provider-failure copy shipped", bundle.includes("Could not send the code right now"));

// The admin order-detail page is code-split and not referenced by the list
// page's HTML — sweep every built chunk on disk instead (the driver runs
// beside the standalone build it is testing).
const { readdirSync, readFileSync } = await import("node:fs");
const chunksDir = resolve(REPO_ROOT, "apps/storefront/.next/standalone/apps/storefront/.next/static/chunks");
let allChunks = "";
try {
  for (const f of readdirSync(chunksDir)) {
    if (f.endsWith(".js")) allChunks += readFileSync(resolve(chunksDir, f), "utf8");
  }
} catch {
  /* directory layout changed — the checks below will report honestly */
}
let adminChunks = "";
const adminChunksDir = resolve(REPO_ROOT, "apps/admin/.next/standalone/apps/admin/.next/static/chunks");
try {
  for (const f of readdirSync(adminChunksDir)) {
    if (f.endsWith(".js")) adminChunks += readFileSync(resolve(adminChunksDir, f), "utf8");
  }
} catch {
  /* directory layout changed — the checks below will report honestly */
}
check("D1 admin cancel-warning copy shipped (TrxID-release warning)", adminChunks.includes("Cancelling now will release TrxID"));
check("D1 admin SMS-match tick copy still shipped", adminChunks.includes("I matched the amount and TrxID"));

// ── summary ────────────────────────────────────────────────────────────
console.log(`\n── Result: ${passed} passed, ${failed} failed ──`);
process.exit(failed === 0 ? 0 : 1);
