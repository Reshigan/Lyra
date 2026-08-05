import {
  data,
  Outlet,
  redirect,
  useLoaderData,
  useRouteLoaderData,
  type LoaderFunctionArgs,
  type MetaFunction
} from "react-router";
import { cloudflare } from "../context";
import { ApiError, fetchMe } from "../api.server";
import { Shell } from "../components/shell";
import { translator } from "../i18n";
import { DEFAULT_PACK } from "../modules/vocabulary";

// Everything behind a session hangs off this layout. One bootstrap call feeds
// the whole shell: actor, tenant brand, permissions and the nav the API already
// filtered for them.

export const ROUTE_ID = "routes/workspace";

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

  // "/" used to redirect to the actor's primary workspace. It is now a real
  // screen (routes/home.tsx): what is waiting on me, how the business is doing,
  // where I go next — which beats being teleported into a list.
  return {
    locale: me.locale,
    nav: me.nav,
    permissions: me.permissions,
    brand: me.tenant.brand,
    tenantName: me.tenant.name,
    actorName: me.profile?.name ?? null,
    // CLAUDE.md §14: the pack that renames every noun downstream of labelsFor.
    domainPack: typeof me.policy?.domainPack === "string" ? me.policy.domainPack : DEFAULT_PACK,
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

export default function Workspace() {
  const shell = useLoaderData<typeof loader>();
  const t = translator(shell.locale, shell.overrides);

  return (
    <Shell
      t={t}
      nav={shell.nav}
      brand={shell.brand}
      tenantName={shell.tenantName}
      actorName={shell.actorName}
    >
      <Outlet />
    </Shell>
  );
}
