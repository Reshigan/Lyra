import { describe, expect, it } from "vitest";
import { TXN_PRECONDITIONS } from "./preconditions.js";

function fakeCtx(aggregationMin: number, status = "published") {
  return {
    tenantId: "t1",
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ aggregationMin, status }])
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

  it("refuses a product that is not published, whatever the cell count", async () => {
    // A draft was never approved for sale and a suspended one has been pulled,
    // often for the same disclosure reasons this gate exists to enforce.
    await rejects(
      TXN_PRECONDITIONS["DPROD-DELIVER"]!(fakeCtx(50, "draft"), { dataProductId: "dp1", cellCount: 500 }),
      /not published/i
    );
    await rejects(
      TXN_PRECONDITIONS["DPROD-DELIVER"]!(fakeCtx(50, "suspended"), { dataProductId: "dp1", cellCount: 500 }),
      /not published/i
    );
  });

  it("passes when cellCount meets the product's aggregationMin", async () => {
    const ctx = fakeCtx(50);
    await expect(
      TXN_PRECONDITIONS["DPROD-DELIVER"]!(ctx, { dataProductId: "dp1", cellCount: 50 })
    ).resolves.toBeUndefined();
  });
});
