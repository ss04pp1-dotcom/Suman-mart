#!/bin/bash
# Boot the production standalone server for E2E.
# The sandbox reaps background processes between tool calls — re-run this
# script whenever the server has died (it is idempotent).
#
# SAFEGUARDS (round-4 audit — this script once committed fixed test secrets):
#   • ALL session/TOTP secrets are generated FRESH per boot (openssl rand) —
#     nothing secret is committed to the repository.
#   • Refuses to boot unless the target DB lives inside this checkout.
cd "$(dirname "$0")/../.."   # repo root

DB_PATH="$PWD/db/custom.db"
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

pkill -f "standalone/server.js" 2>/dev/null
sleep 1
DATABASE_URL="file:$DB_PATH" \
RATELIMIT_DATABASE_URL="file:$PWD/db/ratelimit.db" \
NEXT_PUBLIC_SITE_URL=http://localhost:3000 \
SITE_URL=http://127.0.0.1:${E2E_PORT:-3111} \
SESSION_SECRET="$SESSION_SECRET" \
ADMIN_SESSION_SECRET="$ADMIN_SESSION_SECRET" \
TOTP_ENC_KEY="$TOTP_ENC_KEY" \
RESEND_API_KEY="${E2E_RESEND_API_KEY:-}" \
HOSTNAME=127.0.0.1 PORT=${E2E_PORT:-3111} NODE_ENV=production \
nohup bun .next/standalone/server.js > /tmp/e2e-server.log 2>&1 &
sleep 4
curl -s -o /dev/null -w "server: %{http_code}\n" "http://127.0.0.1:${E2E_PORT:-3111}/api/settings/public"
