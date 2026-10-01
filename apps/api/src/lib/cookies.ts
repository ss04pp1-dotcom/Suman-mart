// Cookie helpers for Hono (replaces next/headers `cookies()`).
//
// Serialises Set-Cookie header values directly. Sessions ride HttpOnly
// SameSite=Lax cookies; `Secure` is set in production exactly like the
// monolith (NODE_ENV=production, derived from the ENVIRONMENT binding by the
// env bridge). The storefront/admin runtime proxies forward Set-Cookie
// verbatim, and because the Workers API never sets a Domain attribute the
// browser scopes the cookie to whatever origin it talked to (the proxy) —
// same-origin behaviour is preserved end-to-end.

export interface CookieOptions {
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
  path?: string;
  maxAge?: number;
}

export function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const parts = [`${name}=${value}`];
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite.charAt(0).toUpperCase()}${opts.sameSite.slice(1)}`);
  if (opts.secure) parts.push("Secure");
  if (opts.path) parts.push(`Path=${opts.path}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join("; ");
}

/** Append a Set-Cookie header to the outgoing response (multiple allowed). */
export function appendSetCookie(res: Response, cookie: string): Response {
  res.headers.append("set-cookie", cookie);
  return res;
}

/** Read a cookie value from a Cookie header. */
export function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}
