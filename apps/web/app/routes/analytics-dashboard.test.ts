import { describe, expect, it } from "vitest";
import { tileHealth, type TileResult } from "./analytics-dashboard";

const table = { title: "t", columns: [], rows: [], generatedAt: 0 };

describe("tileHealth", () => {
  it("counts a tile with no table as failed even without an error string", () => {
    const tiles: TileResult[] = [{ key: "a" }, { key: "b", table }];
    expect(tileHealth(tiles)).toEqual({ ok: 1, failed: 1, total: 2 });
  });

  it("counts an explicit tile error as failed", () => {
    const tiles: TileResult[] = [{ key: "a", error: "denied" }];
    expect(tileHealth(tiles)).toEqual({ ok: 0, failed: 1, total: 1 });
  });

  it("is all-ok when every tile has a table", () => {
    const tiles: TileResult[] = [
      { key: "a", table },
      { key: "b", table }
    ];
    expect(tileHealth(tiles)).toEqual({ ok: 2, failed: 0, total: 2 });
  });

  it("is zero-total on an empty dashboard", () => {
    expect(tileHealth([])).toEqual({ ok: 0, failed: 0, total: 0 });
  });
});
