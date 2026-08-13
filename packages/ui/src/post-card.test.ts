import { describe, expect, it } from "vitest";
import { POST_RATIOS, postCardSvg, wrap } from "./post-card.js";

const base = { headline: "Cover the gap before renewal", brandName: "GONXT" };

describe("wrap", () => {
  it("breaks on words, never mid-word", () => {
    expect(wrap("alpha beta gamma delta", 12, 4)).toEqual(["alpha beta", "gamma delta"]);
  });

  it("marks copy it had to cut", () => {
    const lines = wrap("one two three four five six seven eight", 9, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith("…")).toBe(true);
  });
});

describe("postCardSvg", () => {
  it("renders at the frame the network takes", () => {
    for (const [ratio, box] of Object.entries(POST_RATIOS)) {
      const svg = postCardSvg({ ...base, ratio: ratio as keyof typeof POST_RATIOS });
      expect(svg).toContain(`viewBox="0 0 ${box.w} ${box.h}"`);
    }
  });

  // SVG is XML: tenant copy carrying an ampersand used to produce a file no
  // renderer would open.
  it("escapes the copy it was handed", () => {
    const svg = postCardSvg({ ...base, headline: 'Claims & "cover" <now>', body: "R&D" });
    expect(svg).toContain("Claims &amp; &quot;cover&quot; &lt;now&gt;");
    expect(svg).not.toMatch(/<text[^>]*>[^<]*<now>/);
  });

  it("paints the tenant's accent, not the product's", () => {
    const svg = postCardSvg({ ...base, accent: "#ff5500", accentContrast: "#ffffff" });
    expect(svg).toContain("#ff5500");
    expect(svg).not.toContain("#c8f163");
  });

  it("falls back to the product accent when the tenant set none", () => {
    expect(postCardSvg(base)).toContain("#c8f163");
  });

  it("turns the card over for Arabic", () => {
    const svg = postCardSvg({ ...base, locale: "ar", headline: "غطِّ الفجوة قبل التجديد" });
    expect(svg).toContain('direction="rtl"');
    expect(svg).toContain('text-anchor="end"');
    expect(svg).toContain("IBM Plex Sans Arabic");
  });

  it("signs the card with the tenant's brand name", () => {
    expect(postCardSvg(base)).toContain(">GONXT<");
  });

  it("shrinks the headline rather than overflowing the frame", () => {
    const long = postCardSvg({ ...base, headline: "x ".repeat(60) });
    const short = postCardSvg(base);
    const sizeOf = (svg: string) => Number(svg.match(/\.head \{ fill: [^;]+; font-size: (\d+)px/)?.[1]);
    expect(sizeOf(long)).toBeLessThan(sizeOf(short));
  });
});
