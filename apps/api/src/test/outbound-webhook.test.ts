import { describe, it, expect, vi, afterEach } from "vitest";
import { fireWebhook, assertSafeWebhookUrl, type WebhookPayload } from "../lib/infra/outbound-webhook.js";
import { assertPublicTarget } from "../lib/url-ingest.js";

const PAYLOAD: WebhookPayload = {
  event: "memory.updated",
  workspaceId: "ws-test",
  version: 1,
  synthesizedAt: new Date().toISOString(),
};

// These reject before any network I/O — IP-literal and hostname checks
// short-circuit ahead of DNS resolution and fetch.
describe("fireWebhook SSRF policy", () => {
  it("rejects non-https URLs", async () => {
    await expect(fireWebhook("http://example.com/hook", PAYLOAD)).rejects.toThrow(/https/);
  });

  it("rejects invalid URLs", async () => {
    await expect(fireWebhook("not a url", PAYLOAD)).rejects.toThrow(/Invalid webhook URL/);
  });

  it("rejects private IPv4 literals", async () => {
    await expect(fireWebhook("https://10.0.0.5/hook", PAYLOAD)).rejects.toThrow(/private/);
    await expect(fireWebhook("https://192.168.1.1/hook", PAYLOAD)).rejects.toThrow(/private/);
    await expect(fireWebhook("https://172.16.0.1/hook", PAYLOAD)).rejects.toThrow(/private/);
    await expect(fireWebhook("https://127.0.0.1/hook", PAYLOAD)).rejects.toThrow(/private/);
  });

  it("rejects loopback hostnames and IPv6 loopback", async () => {
    await expect(fireWebhook("https://localhost/hook", PAYLOAD)).rejects.toThrow(/private/);
    await expect(fireWebhook("https://[::1]/hook", PAYLOAD)).rejects.toThrow(/private/);
  });

  it("rejects IPv4-mapped IPv6 private addresses", async () => {
    await expect(fireWebhook("https://[::ffff:127.0.0.1]/hook", PAYLOAD)).rejects.toThrow(/private/);
  });

  it("rejects CGNAT and link-local ranges", async () => {
    await expect(fireWebhook("https://100.64.0.1/hook", PAYLOAD)).rejects.toThrow(/private/);
    await expect(fireWebhook("https://169.254.169.254/hook", PAYLOAD)).rejects.toThrow(/private/);
  });
});

// Redirect handling: delivery follows redirects manually and re-runs the SSRF
// policy on every hop, so a registered public URL can't 3xx-bounce the request
// into private address space. Both targets below are public IP literals, so no
// DNS resolution happens and no real network I/O occurs (fetch is stubbed).
describe("fireWebhook redirect handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("refuses to follow a redirect to a private address", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://192.168.0.10/internal" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const delivery = fireWebhook("https://93.184.216.34/hook", PAYLOAD);
    await vi.runAllTimersAsync(); // fast-forward the retry backoff
    await delivery; // fireWebhook logs (doesn't throw) after exhausting retries

    // Every attempt hit only the registered URL with auto-redirects disabled —
    // the private Location was rejected before any second hop was fetched.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toBe("https://93.184.216.34/hook");
      expect((call[1] as { redirect?: string }).redirect).toBe("manual");
    }
  });

  it("follows a public redirect and re-POSTs the payload to the target", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 307, headers: { location: "https://93.184.216.35/hook2" } })
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fireWebhook("https://93.184.216.34/hook", PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://93.184.216.35/hook2");
    expect((fetchMock.mock.calls[1][1] as { body?: string }).body).toBe(JSON.stringify(PAYLOAD));
  });
});

describe("assertSafeWebhookUrl", () => {
  it("rejects http:// URLs", async () => {
    await expect(assertSafeWebhookUrl("http://example.com/hook")).rejects.toThrow(/https/);
  });

  it("rejects invalid URLs", async () => {
    await expect(assertSafeWebhookUrl("not-a-url")).rejects.toThrow(/Invalid webhook URL/);
  });

  it("rejects private IPv4 literals", async () => {
    await expect(assertSafeWebhookUrl("https://192.168.1.1/hook")).rejects.toThrow(/private/);
  });

  it("accepts a public https URL (IP literal, no DNS needed)", async () => {
    await expect(assertSafeWebhookUrl("https://93.184.216.34/hook")).resolves.toBeUndefined();
  });
});

describe("assertPublicTarget", () => {
  it("accepts public IP literals without DNS", async () => {
    await expect(assertPublicTarget(new URL("https://93.184.216.34/"))).resolves.toBeUndefined();
  });

  it("rejects .internal hostnames", async () => {
    await expect(assertPublicTarget(new URL("https://metadata.google.internal/"))).rejects.toThrow(/private/);
  });

  it("rejects non-http protocols", async () => {
    await expect(assertPublicTarget(new URL("ftp://example.com/"))).rejects.toThrow(/http/);
  });
});
