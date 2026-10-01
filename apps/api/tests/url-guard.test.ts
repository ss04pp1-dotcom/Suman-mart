import { describe, it, expect } from "vitest";
import { assertSafeOutboundUrl, UrlGuardError } from "@/lib/url-guard";

// DNS-dependent hostnames are avoided: only IP literals and syntactic checks
// are exercised here so the suite stays hermetic.

describe("url-guard (SSRF protection)", () => {
  it("rejects non-http(s) schemes", async () => {
    for (const raw of ["file:///etc/passwd", "ftp://example.com", "javascript:alert(1)", "gopher://x"]) {
      await expect(assertSafeOutboundUrl(raw)).rejects.toBeInstanceOf(UrlGuardError);
    }
  });

  it("rejects private / loopback IPv4 literals", async () => {
    for (const host of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "172.31.255.255", "169.254.169.254", "0.0.0.0", "100.64.0.1"]) {
      await expect(assertSafeOutboundUrl(`https://${host}/hook`)).rejects.toBeInstanceOf(UrlGuardError);
    }
  });

  it("rejects private IPv6 literals", async () => {
    for (const host of ["::1", "[::1]", "fe80::1", "fc00::5", "[::ffff:127.0.0.1]"]) {
      await expect(assertSafeOutboundUrl(`https://${host}/hook`)).rejects.toBeInstanceOf(UrlGuardError);
    }
  });

  it("rejects localhost-style hostnames", async () => {
    for (const host of ["localhost", "api.localhost", "printer.local", "db.internal"]) {
      await expect(assertSafeOutboundUrl(`https://${host}/hook`)).rejects.toBeInstanceOf(UrlGuardError);
    }
  });

  it("rejects unparseable URLs", async () => {
    await expect(assertSafeOutboundUrl("not a url")).rejects.toBeInstanceOf(UrlGuardError);
    await expect(assertSafeOutboundUrl("")).rejects.toBeInstanceOf(UrlGuardError);
  });

  it("accepts public IPv4 literals over https", async () => {
    const url = await assertSafeOutboundUrl("https://1.1.1.1/hook");
    expect(url.hostname).toBe("1.1.1.1");
  });

  it("permits plain http only when explicitly opted in", async () => {
    await expect(assertSafeOutboundUrl("http://93.184.216.34/hook")).rejects.toBeInstanceOf(UrlGuardError);
    const url = await assertSafeOutboundUrl("http://93.184.216.34/hook", { allowHttp: true });
    expect(url.protocol).toBe("http:");
  });
});
