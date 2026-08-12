import {
  data,
  Outlet,
  redirect,
  useLoaderData,
  useRouteError,
  useRouteLoaderData,
  type LoaderFunctionArgs,
  type MetaFunction
} from "react-router";
import { UiCalendarProvider, type CalendarPreference } from "@lyra/ui";
import { cloudflare } from "../context";
import { api, ApiError, fetchMe, names } from "../api.server";
import { ErrorPanel } from "../components/error-panel";
import { Shell } from "../components/shell";
import type { Inbox } from "../components/shift";
import { chosenLocale, DEFAULT_LOCALE, translator } from "../i18n";
import { DEFAULT_PACK } from "../modules/vocabulary";

// Everything behind a session hangs off this layout. One bootstrap call feeds
// the whole shell: actor, tenant brand, permissions and the nav the API already
// filtered for them.

export const ROUTE_ID = "routes/workspace";

export const CALENDARS: readonly CalendarPreference[] = ["gregorian", "islamic-umalqura", "dual"];

/**
 * Last resort when neither the row nor the tenant's policy names a currency.
 * One literal, in one place, so a tenant on a different currency is a policy
 * edit rather than a grep. `Intl.NumberFormat` has no neutral code to fall back
 * to — it throws on an empty one — so this cannot simply be absent.
 */
export const FALLBACK_CURRENCY = "AED";

/** Tenant policy is loosely typed across the wire; an unknown value is Gregorian. */
export function calendarFrom(value: unknown): CalendarPreference {
  return CALENDARS.find((known) => known === value) ?? "gregorian";
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;

  let me;
  try {
    me = await fetchMe(env, request);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      const next = new URL(request.url).pathname;
      throw redirect(`/login?next=${encodeURIComponent(next)}`);
    }
    // Anything else keeps its status and carries the request id to the boundary,
    // so the message a user reads is the one support can look up.
    if (error instanceof ApiError) throw data(error.requestId ?? "", { status: error.status });
    throw error;
  }

  // The shell's day strip and shift block. Tolerant on purpose: this call is
  // decoration around the work, and a queue that failed to load must not take
  // the screen the actor asked for down with it. Both surfaces render nothing
  // when it is null.
  const inbox = await api<Inbox>("/v1/me/inbox", { env, request }).catch(() => null);

  // The rail lists the approvals by what they are about, and an approval holds a
  // ref, not a name. Batched into one call, and skipped entirely when the queue
  // is empty (names() returns {} for no refs without touching the network).
  const subjects = await names(
    (inbox?.approvals ?? []).map((approval) => approval.subjectRef),
    { env, request }
  );

  // "/" used to redirect to the actor's primary workspace. It is now a real
  // screen (routes/home.tsx): what is waiting on me, how the business is doing,
  // where I go next — which beats being teleported into a list.
  return {
    // The explicit choice wins over the stored one, because <html lang>/dir come
    // from that same cookie (root.tsx) and the two must not disagree. The pseudo
    // locale — which no profile can hold — is the case that makes it obvious.
    locale: chosenLocale(request) ?? me.locale,
    inbox,
    names: subjects,
    nav: me.nav,
    permissions: me.permissions,
    brand: me.tenant.brand,
    tenantName: me.tenant.name,
    actorName: me.profile?.name ?? null,
    // CLAUDE.md §14: the pack that renames every noun downstream of labelsFor.
    domainPack: typeof me.policy?.domainPack === "string" ? me.policy.domainPack : DEFAULT_PACK,
    calendar: calendarFrom(me.policy?.calendarPreference),
    // What a money figure is denominated in when the row itself does not say.
    // Same policy field the brand editor writes (settings.tsx).
    currency: typeof me.policy?.currency === "string" ? me.policy.currency : FALLBACK_CURRENCY,
    // A tenant admin's i18n key relabels (core_locale_overrides), merged by
    // translator() over the static catalogue — see apps/web/app/i18n.ts.
    overrides: me.overrides ?? {}
  };
}

export type ShellData = Awaited<ReturnType<typeof loader>>;

/** Shell data for any route rendered inside the layout. */
export function useShellData(): ShellData | undefined {
  return useRouteLoaderData<typeof loader>(ROUTE_ID);
}

export const meta: MetaFunction<typeof loader> = ({ loaderData: loaded }) => [
  // The product name is tenant configuration, never a literal (CLAUDE.md §5).
  { title: loaded?.brand?.name ?? loaded?.tenantName ?? "" }
];

/**
 * A screen inside the session that fails is still a screen. Without a boundary
 * here the nearest one is root's, which replaces the whole document: typing
 * `/north` as an agent who holds no NORTH role dropped the rail, the day strip
 * and the tenant's own brand, and read as a crash rather than a closed door.
 *
 * It has to survive its own layout's loader having failed — the boundary
 * renders for that case too, and there is then no shell to render. The bare
 * panel is the fallback; root's boundary stays the one for a dead document.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const shell = useShellData();
  const t = translator(shell?.locale ?? DEFAULT_LOCALE, shell?.overrides);
  const panel = <ErrorPanel error={error} t={t} className="mx-auto my-16" />;

  if (!shell) return <main className="mx-auto flex min-h-screen max-w-prose flex-col justify-center p-8">{panel}</main>;

  return (
    <UiCalendarProvider calendar={shell.calendar}>
      <Shell
        t={t}
        nav={shell.nav}
        brand={shell.brand}
        tenantName={shell.tenantName}
        actorName={shell.actorName}
        inbox={shell.inbox}
        names={shell.names}
      >
        {panel}
      </Shell>
    </UiCalendarProvider>
  );
}

export default function Workspace() {
  const shell = useLoaderData<typeof loader>();
  const t = translator(shell.locale, shell.overrides);

  return (
    // Every <DateTime> below reads the tenant's calendar off this provider —
    // the alternative is remembering a prop at 124 call sites.
    <UiCalendarProvider calendar={shell.calendar}>
      <Shell
        t={t}
        nav={shell.nav}
        brand={shell.brand}
        tenantName={shell.tenantName}
        actorName={shell.actorName}
        inbox={shell.inbox}
        names={shell.names}
      >
        <Outlet />
      </Shell>
    </UiCalendarProvider>
  );
}
