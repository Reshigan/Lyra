import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CopilotAnswer } from "./case-detail";

// Asking the copilot is the one wait on this screen a person sits through in
// place: the model round trip outlasts the 400ms that docs/15 gives a screen
// before it owes an answer's shape, and until now the card simply held still
// with a disabled button. docs/15-experience-excellence.md line 25 asks for a
// ghost skeleton of the answer shape; docs/ui.md §7.5 (P1-5).

const l = (key: string) => key;

describe("the copilot answer region", () => {
  it("shows the shape of the answer while the model is still thinking", () => {
    const markup = renderToStaticMarkup(<CopilotAnswer pending l={l} />);
    expect(markup).toContain("animate-pulse");
    // The wait is announced, not merely animated — a screen reader gets no
    // pulse. The skeleton itself is aria-hidden by design (packages/ui).
    expect(markup).toContain("copilotThinking");
  });

  it("shows nothing at all before anybody asks", () => {
    expect(renderToStaticMarkup(<CopilotAnswer pending={false} l={l} />)).toBe("");
  });

  it("gives way to the answer once it lands", () => {
    const markup = renderToStaticMarkup(
      <CopilotAnswer pending={false} l={l} answer="The excess is 500 AED." confidence={0.8} mismatches={[]} />
    );
    expect(markup).toContain("The excess is 500 AED.");
    expect(markup).not.toContain("animate-pulse");
  });
});
