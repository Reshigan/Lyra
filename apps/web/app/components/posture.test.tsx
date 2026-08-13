import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { PostureChips } from "./posture";
import type { Posture } from "./shift";

// A closed door is not shown as a disabled one (docs/07 §3): the half of the
// posture an actor may not read is absent from the bar, not greyed out in it.

const t = (key: string) => key;

function render(posture: Posture | null) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <PostureChips posture={posture} t={t} />
    </MemoryRouter>
  );
}

describe("the header posture chips", () => {
  it("drops the money chip when client money is unreadable, keeping the period", () => {
    const markup = render({ clientMoney: null, period: { code: "2026-08", state: "open" } });
    expect(markup).not.toContain("/ledger/statement");
    expect(markup).toContain("2026-08");
    expect(markup).toContain("period.open");
  });

  it("flags a breach on the money chip and links to the account it came from", () => {
    const markup = render({
      clientMoney: { heldMinor: 125000, currency: "ZAR", breach: true },
      period: null
    });
    expect(markup).toContain('data-breach="true"');
    expect(markup).toContain("bg-danger");
    expect(markup).toContain("account=1010");
    expect(markup).not.toContain("/ledger/period-close");
  });

  it("renders nothing at all when the inbox carried no posture", () => {
    expect(render(null)).toBe("");
  });
});
