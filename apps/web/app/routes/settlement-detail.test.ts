import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api-error";
import { detailHeadlineKey, netBalance, netLegs } from "./settlement-detail";

vi.mock("../api.server", async () => ({ api: vi.fn(), fetchMe: vi.fn(), ApiError: (await import("../api-error")).ApiError }));
vi.mock("../context", () => ({ cloudflare: { toString: () => "cloudflare-context" } }));

import { api, fetchMe } from "../api.server";
import { loader } from "./settlement-detail";

const fakeContext = () => ({ get: () => ({ env: { API_ORIGIN: "https://api.lyra.test" } }) });

describe("detailHeadlineKey", () => {
  it("flags a ledger mismatch even when a decision is open", () => {
    expect(detailHeadlineKey(false, 2)).toBe("mismatch");
  });

  it("calls out an open decision when the net holds", () => {
    expect(detailHeadlineKey(true, 1)).toBe("actionable");
  });

  it("falls back to a plain readout once nothing is open", () => {
    expect(detailHeadlineKey(true, 0)).toBe("plain");
  });
});

/* ------------------------------------------------------------- the money flow */

// What the flow diagram draws for a settlement: what the period earned less what
// was adjusted, arriving as the net that will be paid. The two sides are the
// same invariant `netHolds` checks, so the picture cannot claim a total the
// arithmetic does not support (CLAUDE.md §12).

const l = (key: string) => key;
const totals = { grossMinor: 500_00, adjustmentsMinor: -50_00, netMinor: 450_00 };

describe("netLegs", () => {
  it("puts what was earned and what was adjusted against what is payable", () => {
    expect(netLegs(totals, l).map((leg) => [leg.account, leg.side, leg.amountMinor])).toEqual([
      ["gross", "debit", 500_00],
      ["adjustments", "debit", -50_00],
      ["net", "credit", 450_00]
    ]);
  });

  it("adds up to the totals the balance reports, side for side", () => {
    const balance = netBalance(totals);
    const legs = netLegs(totals, l);
    const sum = (side: string) =>
      legs.filter((leg) => leg.side === side).reduce((n, leg) => n + leg.amountMinor, 0);
    expect(sum("debit")).toBe(balance.debitMinor);
    expect(sum("credit")).toBe(balance.creditMinor);
  });
});

describe("netBalance", () => {
  it("balances when gross and adjustments make the net", () => {
    expect(netBalance(totals)).toEqual({
      debitMinor: 450_00,
      creditMinor: 450_00,
      deltaMinor: 0,
      balanced: true
    });
  });

  it("names the discrepancy, signed, when they do not", () => {
    const bad = { grossMinor: 500_00, adjustmentsMinor: -50_00, netMinor: 500_00 };
    expect(netBalance(bad)).toEqual({
      debitMinor: 450_00,
      creditMinor: 500_00,
      deltaMinor: -50_00,
      balanced: false
    });
  });
});

describe("loader — a failed /lines fetch is not a permission denial", () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(fetchMe).mockReset();
  });

  const holder = { permissions: ["dist:commissions:read"] };
  const call = () =>
    loader({
      request: new Request("https://lyra.test/ledger/settlements/stl_1"),
      params: { id: "stl_1" },
      context: fakeContext()
    } as never) as Promise<{ lines: unknown; may: { read: boolean } }>;

  it("keeps may.read true when the API answers 4xx", async () => {
    // The screen conflated two facts and told an actor holding
    // dist:commissions:read that they lacked it, because `shut` forced
    // read:false for any 4xx on the lines endpoint.
    vi.mocked(fetchMe).mockResolvedValue(holder as never);
    vi.mocked(api).mockRejectedValueOnce(new ApiError({ title: "bad request", status: 400 }, null));
    const out = await call();
    expect(out.lines).toBeNull();
    expect(out.may.read).toBe(true);
  });

  it("still reports a denial when the actor holds nothing", async () => {
    vi.mocked(fetchMe).mockResolvedValue({ permissions: [] } as never);
    const out = await call();
    expect(out.may.read).toBe(false);
    expect(vi.mocked(api)).not.toHaveBeenCalled();
  });

  it("rethrows a 5xx rather than presenting it as an empty statement", async () => {
    vi.mocked(fetchMe).mockResolvedValue(holder as never);
    vi.mocked(api).mockRejectedValueOnce(new ApiError({ title: "boom", status: 500 }, null));
    await expect(call()).rejects.toThrow();
  });
});
