// Lightweight user-agent parsing, geo resolution and traffic-source attribution.

export type Device = "MOBILE" | "DESKTOP" | "TABLET";

export interface ClientInfo {
  device: Device;
  browser: string;
  os: string;
  country: string;
  region: string;
}

export function parseUserAgent(ua: string): { device: Device; browser: string; os: string } {
  const s = ua || "";

  const isTablet = /iPad|Tablet|PlayBook|Silk/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s));
  const isMobile = /iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|Opera Mini|IEMobile/i.test(s);
  const device: Device = isTablet ? "TABLET" : isMobile ? "MOBILE" : "DESKTOP";

  let browser = "Unknown";
  if (/Edg\//i.test(s)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(s)) browser = "Opera";
  else if (/SamsungBrowser/i.test(s)) browser = "Samsung Internet";
  else if (/Firefox\//i.test(s)) browser = "Firefox";
  else if (/Chrome\//i.test(s)) browser = "Chrome";
  else if (/Safari\//i.test(s)) browser = "Safari";

  let os = "Unknown";
  if (/Windows NT 10/i.test(s)) os = "Windows";
  else if (/Windows/i.test(s)) os = "Windows";
  else if (/Android/i.test(s)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(s)) os = "iOS";
  else if (/Mac OS X/i.test(s)) os = "macOS";
  else if (/Linux/i.test(s)) os = "Linux";

  return { device, browser, os };
}

export function geoFromHeaders(h: Headers): { country: string; region: string } {
  // Cloudflare / common proxy headers
  const country = h.get("cf-ipcountry") ?? h.get("x-vercel-ip-country") ?? "BD";
  const region = h.get("cf-region") ?? h.get("x-vercel-ip-country-region") ?? "";
  return { country, region };
}

export type TrafficSource = "DIRECT" | "GOOGLE" | "FACEBOOK" | "INSTAGRAM" | "TIKTOK" | "OTHER";

export interface Attribution {
  source: TrafficSource;
  medium: string;
  campaign: string | null;
  content: string | null;
  term: string | null;
  referrer: string | null;
}

export function resolveAttribution(params: {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  referrer?: string | null;
}): Attribution {
  const utmSource = params.utmSource?.trim();
  const referrer = params.referrer?.trim() || null;

  let source: TrafficSource = "DIRECT";
  if (utmSource) {
    const s = utmSource.toLowerCase();
    if (s.includes("google")) source = "GOOGLE";
    else if (s.includes("facebook") || s === "fb") source = "FACEBOOK";
    else if (s.includes("instagram") || s === "ig") source = "INSTAGRAM";
    else if (s.includes("tiktok") || s === "tt") source = "TIKTOK";
    else source = "OTHER";
  } else if (referrer) {
    try {
      const host = new URL(referrer).hostname.replace(/^www\./, "");
      if (host.includes("google")) source = "GOOGLE";
      else if (host.includes("facebook") || host === "fb.com") source = "FACEBOOK";
      else if (host.includes("instagram")) source = "INSTAGRAM";
      else if (host.includes("tiktok")) source = "TIKTOK";
      else if (host) source = "OTHER";
    } catch {
      /* keep DIRECT */
    }
  }

  return {
    source,
    medium: params.utmMedium?.trim() || (source === "DIRECT" ? "none" : "referral"),
    campaign: params.utmCampaign?.trim() || null,
    content: params.utmContent?.trim() || null,
    term: params.utmTerm?.trim() || null,
    referrer,
  };
}
