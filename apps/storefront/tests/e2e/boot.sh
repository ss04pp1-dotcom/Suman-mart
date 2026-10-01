#!/bin/bash
# Boot the production standalone servers for E2E — THREE-TIER topology.
# The sandbox reaps background processes between tool calls — re-run this
# script whenever the servers have died (it is idempotent).
#
# Boots ALL THREE deployables:
#   • Workers API on :8787  (apps/api — `wrangler dev` with local D1 + R2;
#                 the only process that touches the database)
#   • storefront  on :3111  (apps/storefront/.next/standalone — pure UI +
#                 proxy: /api/* → ${BACKEND_ORIGIN}/v1/*)
#   • admin app   on :3112  (apps/admin/.next/standalone — pure UI + proxy:
#                 /api/admin/* → ${BACKEND_ORIGIN}/v1/admin/*)
#
# SAFEGUARDS (round-4 audit — this script once committed fixed test secrets):
#   • Session secrets are read from apps/api/.dev.vars (gitignored, local
#     dev only) and passed VERBATIM to both Next apps — the edge middleware
#     must verify JWTs with the same keys the API signs them with.
#   • The Resend key is deliberately INVALID by default (simulated provider
#     outage — exactly what the round-5 driver tests). Export
#     E2E_RESEND_API_KEY="" to boot with NO provider instead.
set -e

STOREFRONT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"   # apps/storefront
ADMIN_DIR="$(cd "$STOREFRONT_DIR/../admin" && pwd)"     # apps/admin
API_DIR="$(cd "$STOREFRONT_DIR/../api" && pwd)"         # apps/api
REPO_ROOT="$(cd "$STOREFRONT_DIR/../.." && pwd)"        # monorepo root

if [ "${E2E_BOOT:-0}" != "1" ]; then
  echo "[e2e-boot] REFUSING: set E2E_BOOT=1 to confirm you are booting the dev sandbox server." >&2
  exit 1
fi
if [ ! -f "$API_DIR/.dev.vars" ]; then
  echo "[e2e-boot] REFUSING: $API_DIR/.dev.vars not found — copy .dev.vars.example first." >&2
  exit 1
fi
for standalone in "$STOREFRONT_DIR/.next/standalone/apps/storefront/server.js" "$ADMIN_DIR/.next/standalone/apps/admin/server.js"; do
  if [ ! -f "$standalone" ]; then
    echo "[e2e-boot] REFUSING: $standalone missing — build first (bun run build / build:admin)." >&2
    exit 1
  fi
done

# Secrets from the API's dev file (single source of truth for the trio).
SESSION_SECRET=$(grep -E '^SESSION_SECRET=' "$API_DIR/.dev.vars" | head -1 | cut -d= -f2-)
ADMIN_SESSION_SECRET=$(grep -E '^ADMIN_SESSION_SECRET=' "$API_DIR/.dev.vars" | head -1 | cut -d= -f2-)
if [ -z "$SESSION_SECRET" ] || [ -z "$ADMIN_SESSION_SECRET" ]; then
  echo "[e2e-boot] REFUSING: SESSION_SECRET/ADMIN_SESSION_SECRET missing from apps/api/.dev.vars." >&2
  exit 1
fi

# Simulated Resend outage: an invalid key makes every delivery attempt fail
# HONESTLY (the round-5 breaker test depends on it).
E2E_RESEND_API_KEY="${E2E_RESEND_API_KEY:-re_invalid_e2e_outage_key}"
RESEND_ARGS=(--var "RESEND_API_KEY:$E2E_RESEND_API_KEY")

pkill -f "standalone/apps/" 2>/dev/null || true
pkill -f "wrangler dev" 2>/dev/null || true
sleep 1

# 1. Seed the local D1 + R2 (migrations, catalogue, admin accounts, images).
echo "[e2e-boot] seeding local D1 + R2 (dev-seed)…"
( cd "$REPO_ROOT" && node "$API_DIR/scripts/dev-seed.mjs" ) > /tmp/e2e-seed.log 2>&1 || {
  echo "[e2e-boot] seed failed — see /tmp/e2e-seed.log"; exit 1;
}

# 2. Workers API on :8787 (shares .wrangler/state with the seed above).
(
  cd "$API_DIR"
  nohup bunx wrangler dev --port 8787 "${RESEND_ARGS[@]}" > /tmp/e2e-api.log 2>&1 &
)

# 3. Storefront on :3111 (proxy → :8787).
(
  cd "$STOREFRONT_DIR"
  BACKEND_ORIGIN=http://127.0.0.1:8787 \
  NEXT_PUBLIC_SITE_URL=http://localhost:3111 \
  SESSION_SECRET="$SESSION_SECRET" \
  HOSTNAME=127.0.0.1 PORT=3111 NODE_ENV=production \
  nohup bun .next/standalone/apps/storefront/server.js > /tmp/e2e-storefront.log 2>&1 &
)

# 4. Admin app on :3112 (proxy → :8787).
(
  cd "$ADMIN_DIR"
  BACKEND_ORIGIN=http://127.0.0.1:8787 \
  NEXT_PUBLIC_SITE_URL=http://localhost:3112 \
  ADMIN_SESSION_SECRET="$ADMIN_SESSION_SECRET" \
  HOSTNAME=127.0.0.1 PORT=3112 NODE_ENV=production \
  nohup bun .next/standalone/apps/admin/server.js > /tmp/e2e-admin.log 2>&1 &
)

# Wait for the API to come up (the two Next apps retry on demand).
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8787/health > /dev/null 2>&1; then break; fi
  sleep 1
done

echo -n "api:              "; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8787/health"
echo -n "storefront:       "; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3111/api/settings/public"
echo -n "storefront-page:  "; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3111/"
echo -n "admin-app:        "; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3112/admin/login"
echo -n "admin-api-proxy:  "; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3112/api/admin/auth/me"
