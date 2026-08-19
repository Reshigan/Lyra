import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FOCUS, HeroStat, HeroWall, focusIn, lensOf, type Lens } from "./hero";

// Two things are being guarded here, and only one of them is markup.
//
// The first is the promise the drill-down makes: the figure the hero prints and
// the rows the drill-down lists come out of one predicate over one array, so
// they cannot disagree. `lensOf` is where that happens, so every route's
// accuracy test is a call to it — see e.g. routes/axis-quote-desk.test.ts.
//
// The second is that a figure with nothing behind it does not look like a door.

// Labels go through a stand-in translator for the same reason the routes do:
// shell.test.ts's "no hard-coded user-facing English" guard reads test files too,
// and a literal in a `label=` is exactly what it is looking for.
const t = (key: string) => key;

interface Row {
  id: string;
  silent: boolean;
}

const LENSES: Record<string, Lens<Row>> = {
  silent: (row) => row.silent,
  loud: (row) => !row.silent
};

const rows: Row[] = [
  { id: "a", silent: true },
  { id: "b", silent: false },
  { id: "c", silent: true }
];

function render(node: ReactNode) {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

describe("a hero figure's lens", () => {
  it("counts and lists the same rows, so the figure and the drill-down agree", () => {
    // The figure the hero prints…
    const figure = lensOf(rows, LENSES, "silent").length;
    // …and the list the screen shows once that hero is clicked.
    const listed = lensOf(rows, LENSES, focusIn(new URLSearchParams(`${FOCUS}=silent`), LENSES));
    expect(figure).toBe(2);
    expect(listed).toHaveLength(figure);
    expect(listed.map((row) => row.id)).toEqual(["a", "c"]);
  });

  it("shows the whole set for no focus, so the lenses partition it", () => {
    expect(lensOf(rows, LENSES, null)).toHaveLength(3);
    expect(lensOf(rows, LENSES, "silent").length + lensOf(rows, LENSES, "loud").length).toBe(3);
  });

  it("falls back to the whole set for a focus nobody defined", () => {
    // A hand-typed or stale `?focus=` must not render an empty screen that
    // reads as "you have no work".
    expect(lensOf(rows, LENSES, "nonsense")).toHaveLength(3);
    expect(focusIn(new URLSearchParams(`${FOCUS}=nonsense`), LENSES)).toBeNull();
    expect(focusIn(new URLSearchParams(""), LENSES)).toBeNull();
  });
});

describe("a hero figure", () => {
  it("is a real link when it has rows behind it", () => {
    const markup = render(<HeroStat label={t("stat.silent")} value={2} to={`?${FOCUS}=silent`} />);
    expect(markup).toContain("<a ");
    expect(markup).toContain(`${FOCUS}=silent`);
    // WCAG 2.2 AA: focus stays visible on the tile the keyboard reaches.
    expect(markup).toContain("focus-visible:ring-2");
  });

  it("is plain text when there is nothing to drill into", () => {
    const markup = render(<HeroStat label={t("stat.median")} value={t("value.median")} />);
    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain("hover:bg-surface-2");
    expect(markup).toContain("value.median");
  });

  it("marks the figure the screen is currently filtered by", () => {
    const markup = render(<HeroStat label={t("stat.silent")} value={2} to={`?${FOCUS}=silent`} active />);
    expect(markup).toContain('aria-current="true"');
  });
});

describe("the hero wall", () => {
  it("offers a way back to everything once a hero has filtered the screen", () => {
    const markup = render(
      <HeroWall focus="silent" allLabel={t("heroAll")}>
        <HeroStat label={t("stat.silent")} value={2} to={`?${FOCUS}=silent`} active />
      </HeroWall>
    );
    expect(markup).toContain("heroAll");
  });

  it("says nothing about filters when none is applied", () => {
    const markup = render(
      <HeroWall focus={null} allLabel={t("heroAll")}>
        <HeroStat label={t("stat.silent")} value={2} to={`?${FOCUS}=silent`} />
      </HeroWall>
    );
    expect(markup).not.toContain("heroAll");
  });
});
