
// Ported from the storefront. The Node version resolved the hostname via
// dns/promises to block names that resolve into private ranges. Cloudflare
// Workers have no DNS API — but Workers' fetch CANNOT reach private/loopback
// networks at all (requests leave through Cloudflare's edge, which has no
// route to RFC1918/link-local space), so the platform enforces the property
// the DNS check provided. All syntactic checks are preserved unchanged.

// ─────────────────────────────────────────────────────────────────────────
// SSRF guard for outbound fetches to operator-configured URLs
// (custom tracking webhooks, supplier base URLs).
//
// Blocks non-HTTP(S) schemes, literal private/loopback/link-local IPs and
// hostnames that RESOLVE to private addresses (DNS rebinding's static cousin).
// ─────────────────────────────────────────────────────────────────────────

const PRIVATE_V4_PATTERNS = [
  /^127\./, // loopback
  /^10\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^169\.254\./, // link-local (cloud metadata 169.254.169.254)
  /^0\./, // "this" network
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64.0.0/10
];

function isPrivateV4(ip: string): boolean {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false;
  const parts = ip.split(".").map(Number);
  if (parts.some((p) => p > 255)) return false;
  const normalized = parts.join(".");
  if (/^172\./.test(normalized)) {
    const second = parts[1];
    return second >= 16 && second <= 31; // RFC1918 172.16.0.0/12
  }
  return PRIVATE_V4_PATTERNS.some((re) => re.test(normalized));
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:")) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique-local fc00::/7
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped — URL normalizes dotted quad to hex (127.0.0.1 → 7f00:1)
    const tail = lower.slice("::ffff:".length);
    const hexMatch = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMatch) {
      const h = (parseInt(hexMatch[1], 16) << 16) | parseInt(hexMatch[2], 16);
      const dotted = [(h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff].join(".");
      return isPrivateV4(dotted);
    }
    return isPrivateV4(tail); // dotted form
  }
  return false;
}

function isPrivateIp(ip: string): boolean {
  return ip.includes(".") ? isPrivateV4(ip) : isPrivateV6(ip);
}

export class UrlGuardError extends Error {}

/**
 * Validate an operator-supplied URL for outbound requests.
 * @param raw URL string (e.g. webhook endpoint or supplier API base)
 * @param opts.allowHttp permit plain http:// for local/dev environments
 * @returns the parsed URL (normalized)
 */
export async function assertSafeOutboundUrl(raw: string, opts: { allowHttp?: boolean } = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlGuardError("Invalid URL");
  }

  const scheme = url.protocol.replace(":", "").toLowerCase();
  if (scheme === "https") {
    // ok
  } else if (scheme === "http" && opts.allowHttp) {
    // ok (explicit opt-in)
  } else {
    throw new UrlGuardError(`Only ${opts.allowHttp ? "http/https" : "https"} URLs are allowed`);
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new UrlGuardError("URL has no host");

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new UrlGuardError("Local/internal hostnames are not allowed");
  }

  // Literal IP?
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":")) {
    if (isPrivateIp(host)) throw new UrlGuardError("Private network addresses are not allowed");
  }
  // NOTE: hostname DNS resolution is not performed on Workers — fetches from
  // inside a Worker cannot reach private networks (edge-routed by design),
  // so a hostname resolving to 10.x is unreachable rather than blocked here.

  return url;
}
