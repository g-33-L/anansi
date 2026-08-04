import { describe, it, expect } from "vitest";
import { isPrivateAddress, revalidatingLookup } from "../lib/infra/safe-fetch.js";
import type { LookupAddress } from "dns";

// Private-address classifier (moved here from url-ingest) + the connection-time
// revalidating lookup that pins fetch to a vetted public IP (SSRF rebinding).
// Uses only localhost / IP literals — no external network, fully deterministic.

describe("isPrivateAddress", () => {
  it("flags RFC1918, loopback, CGNAT, and link-local IPv4", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "192.168.1.1", "172.16.5.5", "169.254.169.254", "100.64.0.1", "0.0.0.0"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });

  it("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "93.184.216.34", "1.1.1.1"]) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });

  it("flags IPv6 loopback, ULA, link-local, and IPv4-mapped private forms", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });

  it("allows public IPv6", () => {
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });
});

describe("revalidatingLookup", () => {
  const run = (host: string, opts: { all?: boolean; family?: number } = {}) =>
    new Promise<{ err: (Error & { code?: string }) | null; addr?: string | LookupAddress[] }>((resolve) =>
      revalidatingLookup(host, opts, (err, addr) => resolve({ err, addr }))
    );

  it("blocks a hostname that resolves to a private address (rebinding guard)", async () => {
    const { err } = await run("localhost", { all: true }); // → 127.0.0.1 / ::1
    expect(err).toBeTruthy();
    expect(err?.code).toBe("ESSRFBLOCKED");
    expect(err?.message).toMatch(/private address/);
  });

  it("passes a public IP literal and returns the address list when all=true", async () => {
    const { err, addr } = await run("8.8.8.8", { all: true });
    expect(err).toBeNull();
    expect(Array.isArray(addr)).toBe(true);
    expect((addr as LookupAddress[])[0].address).toBe("8.8.8.8");
  });

  it("returns a single address (not an array) when all is not requested", async () => {
    const { err, addr } = await run("8.8.8.8", {});
    expect(err).toBeNull();
    expect(addr).toBe("8.8.8.8");
  });
});
