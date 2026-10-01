#!/usr/bin/env bash
# Migrate media files (product/banner/category images + uploads) to Cloudflare R2.
#
# Usage:
#   bash apps/api/scripts/migrate-media-to-r2.sh            # dry run (list only)
#   bash apps/api/scripts/migrate-media-to-r2.sh --local    # local R2 (miniflare)
#   bash apps/api/scripts/migrate-media-to-r2.sh --remote   # REAL bucket (needs wrangler login)
#
# The bucket must already exist:
#   wrangler r2 bucket create suman-mart-media
#
# After migration, media is served by the Workers API:
#   GET https://api.example.com/v1/media/products/earbuds-1.jpg
# (see apps/api/src/routes/media.ts — content types are derived from the
#  extension; objects keep their logical keys: products/…, banners/…, etc.)
#
# Validation: this script prints a per-prefix object count for the source and
# (after upload) you can list the bucket with:
#   wrangler r2 object get suman-mart-media/products/<file> --remote   # spot check
# Rollback: objects are additive — deleting the bucket (or the copied keys)
# restores the previous state; the source files are never modified or deleted.

set -euo pipefail

MODE="${1:-dry-run}"
STOREFRONT_DIR="$(cd "$(dirname "$0")/../../storefront" && pwd)"
API_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUCKET="suman-mart-media"

case "$MODE" in
  --local) FLAG="--local" ;;
  --remote) FLAG="--remote" ;;
  dry-run) FLAG="" ;;
  *) echo "usage: $0 [--local|--remote]   (no flag = dry run)"; exit 1 ;;
esac

upload_dir() {
  local dir="$1" prefix="$2"
  [ -d "$dir" ] || return 0
  local count=0
  for file in "$dir"/*; do
    [ -f "$file" ] || continue
    name="$(basename "$file")"
    key="$prefix/$name"
    count=$((count + 1))
    if [ -z "$FLAG" ]; then
      echo "  [dry-run] $key"
    else
      ctype="application/octet-stream"
      case "${name##*.}" in
        jpg|jpeg) ctype="image/jpeg" ;;
        png) ctype="image/png" ;;
        webp) ctype="image/webp" ;;
        gif) ctype="image/gif" ;;
        avif) ctype="image/avif" ;;
        svg) ctype="image/svg+xml" ;;
      esac
      (cd "$API_DIR" && bunx wrangler r2 object put "$BUCKET/$key" --file "$file" --content-type "$ctype" $FLAG >/dev/null) || {
        echo "  FAILED: $key"; exit 1;
      }
      echo "  uploaded: $key"
    fi
  done
  echo "  → $count object(s) under $prefix/"
}

echo "Media migration → R2 bucket: $BUCKET (mode: ${FLAG:-dry-run})"
upload_dir "$STOREFRONT_DIR/public/products"  "products"
upload_dir "$STOREFRONT_DIR/public/banners"   "banners"
upload_dir "$STOREFRONT_DIR/public/categories" "categories"
upload_dir "$STOREFRONT_DIR/public/uploads"   "uploads"
echo "Done."
