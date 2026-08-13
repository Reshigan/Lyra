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

/**
 * A filter whose "no filter" row is selected has to say so.
 *
 * The empty option travels to Radix under EMPTY_SENTINEL, but the value handed
 * to the Root did not — so "" matched no item, Radix read it as "nothing
 * chosen", and the trigger rendered the "…" placeholder. NORTH's anomaly queue
 * shipped that way: a "Show" filter whose only readable text was an ellipsis.
 */
describe("select placeholder", () => {
  const options = [
    { value: "", label: "Everything" },
    { value: "new", label: "Unowned" }
  ];

  it("reads back the empty row's label, not the placeholder", () => {
    const markup = renderToStaticMarkup(<Select aria-label="Show" defaultValue="" options={options} />);
    expect(markup).not.toContain("data-placeholder");
    expect(markup).not.toContain("…");
  });

  it("still shows the placeholder when no empty row exists", () => {
    const markup = renderToStaticMarkup(
      <Select aria-label="Show" defaultValue="" options={[{ value: "new", label: "Unowned" }]} />
    );
    expect(markup).toContain("data-placeholder");
  });

  // The sentinel is a rendering detail of the Radix tree; what the form posts
  // is the decoded value, and picking "Everything" has to clear the filter.
  it("submits the decoded value", () => {
    const markup = renderToStaticMarkup(<Select name="state" aria-label="Show" defaultValue="" options={options} />);
    expect(markup).toContain('name="state" value=""');
  });
});
