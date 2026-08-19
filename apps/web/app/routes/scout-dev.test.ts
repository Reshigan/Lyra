import { describe, expect, it } from "vitest";
import { curlFor, sampleText, topKOf, wordCounts, type Span } from "./scout-dev";

// The screen's own claims: the top-K it sends is one the endpoint accepts, the
// curl it prints is the call it just made, the diff summary counts the words
// that moved, and the prefilled phrase is a signal's text rather than its
// envelope. Each would read plausibly while being wrong.

describe("top-K", () => {
  it("takes the whole numbers the endpoint's own bound allows", () => {
    expect(topKOf("1")).toBe(1);
    expect(topKOf("20")).toBe(20);
    expect(topKOf(" 7 ")).toBe(7);
  });

  it("refuses out of range rather than letting the API 422 the reader", () => {
    expect(topKOf("0")).toBeNull();
    expect(topKOf("21")).toBeNull();
  });

  it("refuses a fraction instead of truncating it to something else", () => {
    // Number("7.9") is 7.9, and the endpoint takes int() only; silently
    // flooring would send a number the reader did not type.
    expect(topKOf("7.9")).toBeNull();
    expect(topKOf("-3")).toBeNull();
    expect(topKOf("")).toBeNull();
    expect(topKOf("ten")).toBeNull();
  });
});

describe("word counts", () => {
  const spans: Span[] = [
    { type: "equal", text: "Cover applies to" },
    { type: "delete", text: "the insured vehicle" },
    { type: "insert", text: "any listed vehicle or trailer" },
    { type: "equal", text: "within the territory" }
  ];

  it("counts the words on each side of a change, not the spans", () => {
    expect(wordCounts(spans)).toEqual({ added: 5, removed: 3, kept: 6 });
  });

  it("reads two identical wordings as nothing moved", () => {
    expect(wordCounts([{ type: "equal", text: "Cover applies" }])).toEqual({ added: 0, removed: 0, kept: 2 });
  });

  it("does not count whitespace as a word", () => {
    expect(wordCounts([{ type: "insert", text: "  one \n two  " }]).added).toBe(2);
  });
});

describe("curl", () => {
  it("prints the origin's own path with the key as a variable, never a value", () => {
    const curl = curlFor("https://api.lyra.test", "/v1/scout/signals/similar", { text: "EV cover", topK: 10 });
    expect(curl).toContain("curl -X POST https://api.lyra.test/v1/scout/signals/similar");
    expect(curl).toContain('-H "authorization: Bearer $LYRA_API_KEY"');
    expect(curl).toContain(`-d '${JSON.stringify({ text: "EV cover", topK: 10 })}'`);
  });

  it("sends the tenant nowhere in the body — the key carries it", () => {
    expect(curlFor("https://api.lyra.test", "/v1/scout/signals", { source: "news" })).not.toContain("tenant");
  });
});

describe("sample phrase", () => {
  // `/v1/scout/signals` is generic CRUD, so crud.ts `hydrate()` sends
  // `payloadJson` already parsed. The fixture is that shape.
  it("prefills the signal's own text rather than its JSON envelope", () => {
    expect(
      sampleText([
        {
          id: "sig_1",
          source: "news",
          payloadJson: { text: "Carrier withdraws EV cover", url: "https://x.test" },
          observedAt: 1
        }
      ])
    ).toBe("Carrier withdraws EV cover");
  });

  it("serialises a hydrated payload that carries no text field", () => {
    expect(sampleText([{ id: "sig_4", source: "quotes", payloadJson: { count: 4 }, observedAt: 1 }])).toBe(
      '{"count":4}'
    );
  });

  it("falls back to the raw payload when it carries no text field", () => {
    expect(sampleText([{ id: "sig_2", source: "quotes", payloadJson: '{"count":4}', observedAt: 1 }])).toBe(
      '{"count":4}'
    );
    expect(sampleText([{ id: "sig_3", source: "quotes", payloadJson: "not json", observedAt: 1 }])).toBe("not json");
  });

  it("leaves the field empty when the tenant has ingested nothing", () => {
    expect(sampleText([])).toBe("");
  });
});
