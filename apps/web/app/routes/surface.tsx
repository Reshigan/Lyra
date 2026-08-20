import { data, type LoaderFunctionArgs } from "react-router";
import { Hero, ListScreenView, MobileScreenView, ScreenState, renderSection } from "@lyra/ui";
import { surfaceFor } from "../modules/surfaces";

// One route for every screen the Lyra Constellation design pull drew
// (packages/ui/src/sections/types.ts) — `/surface/:module/:screen`. The
// screens are literal fixture data (apps/web/app/modules/data/surfaces.json,
// see surfaces.ts's own header for why), not yet backed by a real API
// resource: no module+screen pair in the pull lines up with a resource this
// build's `apps/api/src/routes/*` already serves, so every screen here
// renders `ready` off its own data rather than a fetch. A screen wired to a
// real resource later switches its own `state` — the six-state wrapper below
// is what that switch would use, built now so it doesn't get invented ad hoc
// per screen.
//
// `screen.source` is prose chrome text (see ScreenBase's own doc comment in
// types.ts), not a resource path — it renders as-is, it is never fetched.
//
// Known gap, not invented here: the design pull's `hasForecast` AI banner and
// `hasApproval` footer banner (rule/body/amount + Approve / "Say no, with a
// reason" + a policy control) have no field on `Screen`/`ScreenBase` to read
// from. `Gate`/`Problem` (routes/module.tsx) are the real, working pattern
// for an *API-returned* approval-required response — there is no such
// response here yet, so nothing in this file invents `screen.approval`.

export async function loader({ params }: LoaderFunctionArgs) {
  const screen = surfaceFor(params.module ?? "", params.screen ?? "");
  if (!screen) throw data("screen", { status: 404 });
  return { screen };
}

function isEmpty(screen: Awaited<ReturnType<typeof loader>>["screen"]): boolean {
  if (screen.kind === "surface") return screen.sections.length === 0;
  if (screen.kind === "list") return screen.rows.length === 0;
  return screen.phones.length === 0;
}

export default function Surface({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { screen } = loaderData;
  return (
    <div className="flex flex-col gap-6 pb-12">
      <Hero
        eyebrow={screen.eyebrow}
        title={screen.title}
        attn={screen.attn}
        sub={screen.sub}
        mod={screen.mod}
        {...(screen.hero ? { hero: screen.hero } : {})}
      />
      {screen.source ? <p className="whitespace-pre-line font-mono text-12 text-muted">{screen.source}</p> : null}
      <ScreenState state={isEmpty(screen) ? "empty" : "ready"} title="Nothing on this screen yet" body={screen.sub}>
        {screen.kind === "surface" ? (
          <div className="flex flex-col gap-5">
            {screen.sections.map((section, i) => (
              <div key={i}>{renderSection(section, screen.mod)}</div>
            ))}
          </div>
        ) : screen.kind === "list" ? (
          <ListScreenView screen={screen} />
        ) : (
          <MobileScreenView screen={screen} />
        )}
      </ScreenState>
    </div>
  );
}
