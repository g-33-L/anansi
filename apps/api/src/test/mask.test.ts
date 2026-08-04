import { describe, it, expect } from "vitest";
import { maskEmail, maskIp } from "../lib/utils/mask.js";

describe("maskEmail", () => {
  it("keeps the first char of the local part and the full domain", () => {
    expect(maskEmail("alice@example.com")).toBe("a***@example.com");
  });

  it("handles a single-char local part", () => {
    expect(maskEmail("a@x.com")).toBe("a***@x.com");
  });

  it("returns *** for input with no @", () => {
    expect(maskEmail("not-an-email")).toBe("***");
  });

  it("returns *** for empty input", () => {
    expect(maskEmail("")).toBe("***");
  });

  it("returns *** for an empty local part", () => {
    expect(maskEmail("@example.com")).toBe("***");
  });
});

describe("maskIp", () => {
  it("keeps the first two octets of an IPv4 address", () => {
    expect(maskIp("203.0.113.4")).toBe("203.0.*.*");
  });

  it("returns *** for non-IPv4 input", () => {
    expect(maskIp("unknown")).toBe("***");
    expect(maskIp("2001:db8::1")).toBe("***");
    expect(maskIp("")).toBe("***");
  });
});
