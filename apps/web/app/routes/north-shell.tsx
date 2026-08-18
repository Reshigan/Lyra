import { data, Outlet, useLoaderData, useRouteLoaderData, type LoaderFunctionArgs } from "react-router";
import { cloudflare } from "../context";
import { bootstrapSession, type SessionBootstrap } from "../session.server";
import { NorthShell } from "../components/north-shell";

// NORTH's own layout: same bootstrap every other layout uses, but gated —
// an actor whose roles never resolve to "north" is real (bootstrapSession
// already proved that) and simply not entitled to this shell, so this
// throws 403, not 401 (docs/superpowers/specs
// /2026-08-15-north-shell-fork-design.md § Routing).

export const ROUTE_ID = "routes/north-shell";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const session = await bootstrapSession(context.get(cloudflare).env, request);
  if (!session.availableShells.includes("north")) throw data("", { status: 403 });
  return session;
}

/** Session data for any route rendered inside NorthShell. */
export function useNorthSessionData(): SessionBootstrap | undefined {
  return useRouteLoaderData<typeof loader>(ROUTE_ID);
}

export default function NorthShellLayout() {
  const session = useLoaderData<typeof loader>();
  return (
    <NorthShell session={session}>
      <Outlet />
    </NorthShell>
  );
}
