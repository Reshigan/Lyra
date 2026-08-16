import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { NorthShell } from "./north-shell";
import type { SessionBootstrap } from "../session.server";

// shell.test.ts's no-hard-coded-English guard scans every source file
// (this test included) for literal label/aria-label/etc text, so the
// switcher's presence is asserted on its @lyra/ui nav.tsx class
// ("flex flex-col gap-1", ModuleSwitcher's own wrapper — unused elsewhere in
// NorthShell's markup) instead of its translated aria-label text.
const MODULE_SWITCHER_CLASS = "flex flex-col gap-1";

// apps/web's vitest suite is deliberately DOM-free (vitest.config.ts:
// "Rendering tests arrive with the module screens, in Playwright") — no
// jsdom, no @testing-library/react (reverted at Task 8, see
// .superpowers/sdd/task-8-report.md's "Follow-up 2"). None of these three
// assertions depend on a post-mount effect (unlike Meridian's replay
// cursor), so they are fully observable from the static markup: render with
// react-dom/server and assert on the HTML string instead of DOM queries.

function sessionWith(overrides: Partial<SessionBootstrap> = {}): SessionBootstrap {
  return {
    locale: "en",
    inbox: null,
    names: {},
    // routing.ts's HIDDEN_ROUTES documents /north/brief, /north/explorer etc.
    // as deliberately NOT nav destinations (reached from links inside the
    // workspace's own screens, not the rail) — isRouted() only recognises
    // WORKSPACE_PATHS' top-level roots. So the only real /north nav leaf is
    // /north itself; /axis stands in for "some other module's destination".
    nav: [
      { labelKey: "nav.north", href: "/north", icon: "compass" },
      { labelKey: "nav.axis", href: "/axis", icon: "gear" }
    ],
    roles: ["north.exec"],
    permissions: [],
    brand: null,
    tenantName: "Sahab Cover",
    actorName: "Amina Al Farsi",
    domainPack: "insurance",
    calendar: "gregorian",
    currency: "AED",
    overrides: {},
    availableShells: ["north"],
    ...overrides
  };
}

function markupFor(session: SessionBootstrap): string {
  const router = createMemoryRouter(
    [{ path: "/north/brief", element: <NorthShell session={session}>{42}</NorthShell> }],
    { initialEntries: ["/north/brief"] }
  );
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe("NorthShell", () => {
  it("renders only NORTH's own nav destinations, not other modules'", () => {
    const html = markupFor(sessionWith());
    // nav.north is a real catalogue key ("Insight"), not a fallback-to-key
    // case — assert on the rendered label, not the raw key.
    expect(html).toContain('href="/north"');
    expect(html).toContain("Insight");
    expect(html).not.toContain('href="/axis"');
  });

  it("hides the multi-role switcher for a single-shell actor", () => {
    const html = markupFor(sessionWith({ availableShells: ["north"] }));
    expect(html).not.toContain(MODULE_SWITCHER_CLASS);
  });

  it("shows the multi-role switcher for a multi-shell actor", () => {
    const html = markupFor(sessionWith({ availableShells: ["north", "axis"] }));
    expect(html).toContain(MODULE_SWITCHER_CLASS);
  });
});
