import type { LoaderFunctionArgs } from "react-router";
import { api } from "../api.server";
import { cloudflare } from "../context";

// A resource route, not a screen: the shell's companion rail is the only caller.
// Same reason search.ts exists — the session cookie is server-only, so the
// browser cannot reach /v1/ai itself. Fetched on first open rather than in the
// workspace loader, so a rail nobody opens costs nothing.

/** The columns the rail renders. `Run`/`Agent` in routes/ai-console.tsx carry
 *  the rest; the rail is a glance, not the console. */
export interface CompanionRun {
  id: string;
  agentKey: string;
  module: string;
  purpose: string;
  state: string;
  autonomyLevel: string;
  startedAt: string;
}

export interface CompanionAgent {
  key: string;
  module: string;
  autonomyLevel: string;
  status: string;
}

const RUN_LIMIT = 8;

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.get(cloudflare);
  const opts = { env, request };

  // Decoration around the work: a rail that threw on a 403 would take the
  // screen down with it, and the toggle is already hidden without ai:runs:read.
  const [runs, agents] = await Promise.all([
    api<{ data: CompanionRun[] }>(`/v1/ai/runs?sort=startedAt&order=desc&limit=${RUN_LIMIT}`, opts).catch(
      () => ({ data: [] as CompanionRun[] })
    ),
    api<{ data: CompanionAgent[] }>("/v1/ai/agents?sort=key&order=asc&limit=100", opts).catch(() => ({
      data: [] as CompanionAgent[]
    }))
  ]);

  return Response.json({ runs: runs.data ?? [], agents: agents.data ?? [] });
}
