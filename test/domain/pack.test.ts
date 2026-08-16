import { describe, expect, it } from "vitest";
import { deduplicatePreservingOrder, generateShareId, manifestHash } from "../../src/domain/pack";

describe("pack domain", () => {
  it("removes duplicates without changing first-seen order", () => {
    expect(deduplicatePreservingOrder([30, 10, 30, 20, 10])).toEqual([30, 10, 20]);
  });

  it("generates a six-character human-safe share ID", () => {
    const id = generateShareId((array) => array.fill(0));
    expect(id).toBe("222222");
    expect(id).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  });

  it("hashes ordered manifests deterministically", async () => {
    expect(await manifestHash([1, 2])).toBe(await manifestHash([1, 2]));
    expect(await manifestHash([1, 2])).not.toBe(await manifestHash([2, 1]));
  });
});
