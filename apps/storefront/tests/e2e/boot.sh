#!/bin/bash
# Boot the production standalone servers for E2E.
# The sandbox reaps background processes between tool calls — re-run this
# script whenever the servers have died (it is idempotent).
#
# Boots BOTH deployables:
#   • storefront  on :3111  (apps/storefront/.next/standalone — also the
#                 BACKEND_ORIGIN for the admin app's API proxy)
#   • admin app   on :3112  (apps/admin/.next/standalone — pure UI, proxies
#                 /api/admin/* to :3111)
#
# SAFEGUARDS (round-4 audit — this script once committed fixed test secrets):
#   • ALL session/TOTP secrets are generated FRESH per boot (openssl rand) —
#     nothing secret is committed to the repository.
#   • Refuses to boot unless the target DB lives inside this checkout.
STOREFRONT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"   # apps/storefront
REPO_ROOT="$(cd "$STOREFRONT_DIR/../.." && pwd)"         # monorepo root

DB_PATH="$REPO_ROOT/db/custom.db"
if [ ! -f "$DB_PATH" ]; then
  echo "[e2e-boot] REFUSING: $DB_PATH not found — this harness only boots the dev sandbox." >&2
  exit 1
fi
if [ "${E2E_BOOT:-0}" != "1" ]; then
  echo "[e2e-boot] REFUSING: set E2E_BOOT=1 to confirm you are booting the dev sandbox server." >&2
  exit 1
fi

# One-time secrets per boot (never committed). TOTP_ENC_KEY must be ≥32 chars —
# the server refuses to boot in production without it (round-4 hardening).
SESSION_SECRET=$(openssl rand -hex 32)
ADMIN_SESSION_SECRET=$(openssl rand -hex 32)
TOTP_ENC_KEY=$(openssl rand -hex 32)

pkill -f "standalone/apps/" 2>/dev/null
pkill -f "standalone/server.js" 2>/dev/null
sleep 1

# Storefront (backend origin for this E2E) on :3111
(
  cd "$STOREFRONT_DIR"
  DATABASE_URL="file:$DB_PATH" \
  RATELIMIT_DATABASE_URL="file:$REPO_ROOT/db/ratelimit.db" \
  NEXT_PUBLIC_SITE_URL=http://localhost:3111 \
  SITE_URL=http://127.0.0.1:3111 \
  SESSION_SECRET="$SESSION_SECRET" \
  ADMIN_SESSION_SECRET="$ADMIN_SESSION_SECRET" \
  TOTP_ENC_KEY="$TOTP_ENC_KEY" \
  RESEND_API_KEY="${E2E_RESEND_API_KEY:-}" \
  HOSTNAME=127.0.0.1 PORT=3111 NODE_ENV=production \
  nohup bun .next/standalone/apps/storefront/server.js > /tmp/e2e-storefront.log 2>&1 &
)

# Admin app (pure UI + API proxy) on :3112
(
  cd "$REPO_ROOT/apps/admin"
  DATABASE_URL="file:$DB_PATH" \
  RATELIMIT_DATABASE_URL="file:$REPO_ROOT/db/ratelimit.db" \
  NEXT_PUBLIC_SITE_URL=http://localhost:3112 \
  SITE_URL=http://127.0.0.1:3112 \
  SESSION_SECRET="$SESSION_SECRET" \
  ADMIN_SESSION_SECRET="$ADMIN_SESSION_SECRET" \
  TOTP_ENC_KEY="$TOTP_ENC_KEY" \
  BACKEND_ORIGIN=http://127.0.0.1:3111 \
  HOSTNAME=127.0.0.1 PORT=3112 NODE_ENV=production \
  nohup bun .next/standalone/apps/admin/server.js > /tmp/e2e-admin.log 2>&1 &
)

sleep 5
echo -n "storefront: "; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3111/api/settings/public"
echo -n "admin-app:  "; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3112/admin/login"
echo -n "admin-api-proxy: "; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3112/api/admin/auth/me"
