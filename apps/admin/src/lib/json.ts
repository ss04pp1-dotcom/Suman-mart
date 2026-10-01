// Safe JSON helpers for columns stored as TEXT (D1-compatible pattern).

export function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function parseJSONOrNull<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function stringifyJSON(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * JSON for embedding in <script type="application/ld+json"> (or any inline
 * script context). Escapes <, >, & and the Unicode line separators so that a
 * product name containing "</script>" can never break out into markup (XSS).
 */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * CSV cell escaping (RFC 4180 + formula-injection hardening).
 * Cells starting with =, +, -, @, tab or CR are prefixed with an apostrophe so
 * Excel/LibreOffice never evaluates them as formulas.
 */
export function csvEscape(value: unknown): string {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}
