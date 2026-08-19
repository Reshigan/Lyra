import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { flowPlan } from "@lyra/ui";
import { describe, expect, it } from "vitest";
import {
  Doctrine,
  IN_HAND,
  PALETTE,
  SPECIMEN_BALANCE,
  SPECIMEN_COMMENTARY,
  SPECIMEN_LEGS,
  SPECIMEN_MACHINE,
  SPECIMEN_SUPPRESSED,
  SPECIMEN_VISITS
} from "./design";
import { CommentaryChip, commentaryLabels } from "../components/whitespace-commentary";

/** The hero specimen holds real links, so the page needs a router to draw in. */
const draw = (locale: "en" | "ar") =>
  renderToStaticMarkup(
    <MemoryRouter>
      <Doctrine locale={locale} />
    </MemoryRouter>
  );

// The doctrine page is the design system explaining itself: the four rules the
// rest of the platform is built to, the palette and the three type voices. Its
// one hard requirement is that it stays true — a swatch that prints a hex
// copied by hand is a lie the moment a token moves.

describe("the doctrine page", () => {
  it("reads its swatches from the tokens rather than repeating them", () => {
    const markup = draw("en");
    expect(PALETTE.length).toBeGreaterThan(0);
    for (const swatch of PALETTE) expect(markup).toContain(`var(${swatch.token})`);
    // No literal colour anywhere: the page never states a value it cannot
    // re-read, so a re-themed tenant sees its own palette, not ours.
    expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("names all four rules and all three voices", () => {
    const markup = draw("en");
    for (const n of ["01", "02", "03", "04"]) expect(markup).toContain(n);
    for (const family of ["font-serif", "font-display", "font-mono"]) {
      expect(markup).toContain(family);
    }
  });

  it("shows the same doctrine in hand, with the one ✦ the ambient grammar allows", () => {
    const markup = draw("en");
    expect(markup).toContain("In hand");
    for (const row of IN_HAND) expect(markup).toContain(row.value);
    // docs/15 §4: one marker per AI artifact, and none on anything no model
    // wrote. Seven on this page, itemised so an eighth is a question and not a
    // number to bump: rule 02's quote, the specimen card, the ambient section's
    // own prose, the hover ghost, the chip that has a reading, and the two draft
    // trays. The suppressed chip is deliberately not on that list.
    expect(markup.split("✦")).toHaveLength(8);
  });

  it("shows a hero figure as a door and a hero figure that is not one", () => {
    const markup = draw("en");
    // Two linked tiles, the drilled-in one marked, and the way back out.
    expect(markup.match(/href="[^"]*\?focus=/g)).toHaveLength(2);
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain("Show everything");
    // The median carries no link, so nothing on the page suggests it opens.
    expect(markup).toContain("A duration, not a set of rows");
  });

  it("is written in both languages", () => {
    const english = draw("en");
    const arabic = draw("ar");
    expect(english).toContain("Software that takes the shape of the person using it.");
    expect(arabic).not.toContain("Software that takes the shape of the person using it.");
    // Token names are identifiers, not copy: they read the same in both.
    for (const swatch of PALETTE) expect(arabic).toContain(`var(${swatch.token})`);
  });
});

// The playground is where a component is reviewed without a record behind it,
// so its specimens have to obey the same rules a real caller does. A specimen
// that quietly cheats teaches the cheat.

describe("the flow specimens", () => {
  it("is a spine of transitions the specimen machine documents", () => {
    // `flowPlan` throws on an undocumented spine edge; planning it is the check.
    const plan = flowPlan(SPECIMEN_MACHINE, [], "drafted");
    expect(plan.steps.map((step) => step.state)).toEqual([...SPECIMEN_MACHINE.spine]);
    expect(plan.unknown).toEqual([]);
  });

  it("draws every state the specimen machine documents, on the spine or off it", () => {
    const drawn = new Set([...SPECIMEN_MACHINE.spine, ...(SPECIMEN_MACHINE.exits ?? [])]);
    expect([...drawn].sort()).toEqual(Object.keys(SPECIMEN_MACHINE.transitions).sort());
  });

  it("shows all three step tones at once, which is the point of the specimen", () => {
    // A playground that only ever draws `pending` documents a third of the
    // component. `posting` is the one state with both a past and a future.
    const plan = flowPlan(SPECIMEN_MACHINE, SPECIMEN_VISITS, "posting");
    expect(plan.steps.map((step) => step.status)).toEqual(["done", "done", "current", "pending"]);
    expect(plan.unknown).toEqual([]);
  });

  it("never draws an exit as work a live transaction still owes", () => {
    const plan = flowPlan(SPECIMEN_MACHINE, SPECIMEN_VISITS, "posting");
    for (const exit of SPECIMEN_MACHINE.exits ?? []) {
      expect(plan.steps.map((step) => step.state)).not.toContain(exit);
    }
  });

  it("states a balance the specimen legs actually add up to", () => {
    // The component re-adds the legs on screen and downgrades the verdict on a
    // mismatch, so a specimen whose totals disagree with its lines would render
    // as a discrepancy and document the wrong thing.
    const side = (want: string) =>
      SPECIMEN_LEGS.filter((leg) => leg.side === want).reduce((n, leg) => n + leg.amountMinor, 0);
    expect(side("debit")).toBe(SPECIMEN_BALANCE.debitMinor);
    expect(side("credit")).toBe(SPECIMEN_BALANCE.creditMinor);
    expect(SPECIMEN_BALANCE.deltaMinor).toBe(0);
    expect(SPECIMEN_BALANCE.balanced).toBe(true);
  });

  it("carries a when and a who on every hop it claims happened", () => {
    // A flow that cannot say when or by whom is a picture, not a record.
    for (const visit of SPECIMEN_VISITS) {
      expect(visit.at).toBeTypeOf("number");
      expect(visit.actor).toBeTruthy();
    }
  });

  it("draws both flows on the page, in both languages", () => {
    for (const locale of ["en", "ar"] as const) {
      const markup = draw(locale);
      // The accessible names the app supplies, not the kit's own words.
      expect(markup).toContain(locale === "en" ? "Specimen transaction lifecycle" : "دورة حياة حركة نموذجية");
      // Every leg's account code reaches the page; codes are identifiers and
      // are not translated, so the same assertion holds in Arabic.
      for (const leg of SPECIMEN_LEGS) expect(markup).toContain(leg.account);
    }
  });
});

describe("the ambient-AI specimens", () => {
  it("never marks a sentence no model wrote", () => {
    // The ✦ is a claim of authorship, so the two cases that must not carry one
    // are checked directly rather than inferred from a page-wide total: a cell
    // under the k-anonymity floor, and the deterministic fallback sentence
    // (fallbackDescription in apps/api/src/engines/scout-whitespace.ts).
    const wl = commentaryLabels("en");
    const hidden = renderToStaticMarkup(
      <CommentaryChip commentary={SPECIMEN_SUPPRESSED} l={wl} locale="en" />
    );
    expect(hidden).not.toContain("✦");
    expect(hidden).toContain(wl("wc.suppressed"));

    const fallback = renderToStaticMarkup(
      <CommentaryChip commentary={{ ...SPECIMEN_COMMENTARY, ai: null }} l={wl} locale="en" />
    );
    expect(fallback).toContain(SPECIMEN_COMMENTARY.commentary ?? "");
    expect(fallback).not.toContain("✦");
  });

  it("grounds the specimen sentence in the lines the server would have sent", () => {
    // A playground reading that quotes figures its own `why` does not carry
    // would teach the one thing this surface exists to prevent.
    expect(SPECIMEN_COMMENTARY.why).toContain(`Category: ${SPECIMEN_COMMENTARY.evidence?.category}`);
    for (const n of [
      SPECIMEN_COMMENTARY.evidence?.momentum,
      SPECIMEN_COMMENTARY.evidence?.coverage,
      SPECIMEN_COMMENTARY.evidence?.competitionScore,
      SPECIMEN_COMMENTARY.evidence?.signalCount
    ]) {
      expect(SPECIMEN_COMMENTARY.why.some((line) => line.endsWith(`: ${n}`))).toBe(true);
    }
  });
});
