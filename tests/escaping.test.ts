import { describe, it, expect } from "vitest";
import { csvEscape, safeJsonLd } from "@/lib/json";

describe("csvEscape (RFC 4180 + formula injection)", () => {
  it("passes through plain values", () => {
    expect(csvEscape("hello")).toBe("hello");
    expect(csvEscape(42)).toBe("42");
    expect(csvEscape(null)).toBe("");
  });

  it("quotes cells containing commas, quotes or newlines", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralizes CSV formula injection (=, +, -, @, tab)", () => {
    expect(csvEscape("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvEscape("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(csvEscape("-2+3|cmd")).toBe("'-2+3|cmd");
    expect(csvEscape("@import(xss)")).toBe("'@import(xss)");
    expect(csvEscape("\tINJECTED")).toBe("'\tINJECTED");
  });

  it("does not mangle values that merely contain operators", () => {
    expect(csvEscape("5 + 3 = 8")).toBe("5 + 3 = 8");
    expect(csvEscape("user@example.com")).toBe("user@example.com");
  });
});

describe("safeJsonLd (inline <script> XSS hardening)", () => {
  it("escapes < so </script> cannot break out of the script tag", () => {
    const out = safeJsonLd({ name: "</script><img src=x onerror=alert(1)>" });
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c");
  });

  it("escapes > and & as well", () => {
    const out = safeJsonLd({ a: ">", b: "&" });
    expect(out).toContain("\\u003e");
    expect(out).toContain("\\u0026");
  });

  it("still parses as JSON after escaping", () => {
    const data = { name: '<script>"&</script>', n: 5 };
    expect(JSON.parse(safeJsonLd(data))).toEqual(data);
  });

  it("handles null/undefined without throwing", () => {
    expect(safeJsonLd(null)).toBe("null");
    expect(safeJsonLd(undefined)).toBe("null");
  });
});
