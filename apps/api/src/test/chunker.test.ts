import { describe, it, expect } from "vitest";
import { chunkText, chunkBySourceType } from "../lib/ai/chunker.js";

// Guards against the C1 event-loop DoS: chunkText used to spin forever when the
// only sentence boundary in a window landed within `overlapChars` of the window
// start, because `start = boundary - overlapChars` clamped back to the same
// position and re-selected the same boundary. These inputs must return promptly.

describe("chunkText termination", () => {
  it("terminates when the only separator sits near the window start (newline)", () => {
    // 100 'A', a newline, then a long unbroken run — separator at pos 100, far
    // inside the 200-char overlap window. Previously an infinite loop.
    const content = "A".repeat(100) + "\n" + "B".repeat(5000);
    const chunks = chunkText(content);
    expect(chunks.length).toBeGreaterThan(0);
    // Reassembling (accounting for overlap) must cover the whole input
    expect(chunks.join("")).toContain("B".repeat(100));
  });

  it("terminates when the only separator is an early sentence end", () => {
    const content = "x".repeat(58) + ". " + "y".repeat(5000);
    const chunks = chunkText(content);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("terminates with no separators at all", () => {
    const chunks = chunkText("z".repeat(10_000));
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("makes forward progress on adversarial repeated short lines", () => {
    // Many short lines: every window has a separator near its start.
    const content = ("q\n").repeat(6000);
    const chunks = chunkText(content);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("every chunk is within the character ceiling and non-empty", () => {
    const content = "A".repeat(50) + "\n" + "B".repeat(9000);
    const chunks = chunkText(content);
    for (const c of chunks) {
      expect(c.length).toBeGreaterThan(0);
      // maxChars = 512 tokens * 4 chars; allow the trimmed boundary chunk
      expect(c.length).toBeLessThanOrEqual(512 * 4);
    }
  });

  it("returns a single chunk for short input and [] for empty", () => {
    expect(chunkText("hello world")).toEqual(["hello world"]);
    expect(chunkText("   ")).toEqual([]);
  });

  it("chunkBySourceType api_text path also terminates on the DoS input", () => {
    const content = "A".repeat(80) + "\n" + "B".repeat(6000);
    const chunks = chunkBySourceType(content, "api_text");
    expect(chunks.length).toBeGreaterThan(0);
  });
});
