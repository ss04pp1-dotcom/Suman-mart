# Suman Mart — Admin Application

Standalone Next.js deployment of the admin console (`admin.example.com`).
**UI only** — no database, no business logic. All `/api/admin/*` calls and media
paths are proxied at request time to `BACKEND_ORIGIN` by
`src/lib/backend-proxy.ts` (a route-handler proxy; `next.config` rewrites were
rejected because they bake the origin at build time).

## Develop

```bash
bun run dev        # http://localhost:3001  (storefront API expected on :3000)
bun run typecheck
bun run lint
```

## Build & run

```bash
bun run build      # standalone output (server at .next/standalone/apps/admin/server.js)
bun run start
```

## Environment

See `.env.example`. The essential variable is `BACKEND_ORIGIN` — the shared
backend (storefront Node API today; the Cloudflare Workers API after the
admin write-paths are ported — flip the value, change nothing else).

## Notes

- The Prisma schema copy in `prisma/` exists only so the TypeScript build can
  generate the client types the UI imports; the app never opens a database.
- Auth/RBAC is enforced at the backend on every request; this deployment
  merely renders the console.
- Behind the proxy, per-IP rate limits see the admin server — per-EMAIL
  lockouts (admin login, 2FA) remain exact.
