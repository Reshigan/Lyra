import { describe, expect, it, vi } from "vitest";
import { TXN_PRECONDITIONS } from "./preconditions.js";

function fakeCtx(aggregationMin: number) {
  return {
    tenantId: "t1",
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ aggregationMin }])
        })
      })
    }
  } as any;
}

/**
 * AppError carries the human-readable title as `message` and the specific
 * cause as `detail` (see ledger.test.ts), so asserting on `toThrow(/…/)`
 * would only ever test the fixed "Conflict" title — assert on `detail`.
 */
async function rejects(p: Promise<unknown>, detail: RegExp): Promise<void> {
  await expect(p).rejects.toThrow();
  try {
    await p;
  } catch (e) {
    expect((e as { detail?: string }).detail ?? String(e)).toMatch(detail);
  }
}

describe("TXN_PRECONDITIONS[DPROD-DELIVER]", () => {
  it("throws conflict when cellCount is below the product's aggregationMin", async () => {
    const ctx = fakeCtx(50);
    await rejects(
      TXN_PRECONDITIONS["DPROD-DELIVER"]!(ctx, { dataProductId: "dp1", cellCount: 10 }),
      /k-anonymity/i
    );
  });

  it("passes when cellCount meets the product's aggregationMin", async () => {
    const ctx = fakeCtx(50);
    await expect(
      TXN_PRECONDITIONS["DPROD-DELIVER"]!(ctx, { dataProductId: "dp1", cellCount: 50 })
    ).resolves.toBeUndefined();
  });
});
