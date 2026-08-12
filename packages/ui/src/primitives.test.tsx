/**
 * A screen that sizes a control gets the size it asked for.
 *
 * `cn` joins class names; it does not resolve Tailwind conflicts (cn.ts). So
 * the `w-full` that used to live in `controlBase` shipped ahead of the caller's
 * class and won, and nine call sites across apps/web were passing widths that
 * did nothing — most visibly the module filter strip, which rendered one
 * full-width control per row and pushed the table below the fold.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Input, Select, Textarea } from "./primitives.js";

const classesOf = (markup: string) => (markup.match(/class="([^"]*)"/)?.[1] ?? "").split(" ");

describe("control width", () => {
  it("fills its column when the screen says nothing", () => {
    for (const markup of [
      renderToStaticMarkup(<Input aria-label="Reason" />),
      renderToStaticMarkup(<Textarea aria-label="Reason" />),
      renderToStaticMarkup(<Select aria-label="Status" options={[{ value: "a", label: "A" }]} />)
    ]) {
      expect(classesOf(markup)).toContain("w-full");
    }
  });

  it("yields the default when the screen brought a width of its own", () => {
    const sized = renderToStaticMarkup(<Input aria-label="Reason" className="w-56" />);
    expect(classesOf(sized)).toContain("w-56");
    expect(classesOf(sized)).not.toContain("w-full");

    // A flex child that grows is sized by its parent — same story.
    const grows = renderToStaticMarkup(<Input aria-label="Reason" className="flex-1" />);
    expect(classesOf(grows)).not.toContain("w-full");

    // max-w- is a ceiling, not a width: the control still needs to fill.
    const capped = renderToStaticMarkup(<Input aria-label="Reason" className="max-w-prose" />);
    expect(classesOf(capped)).toContain("w-full");
  });
});
