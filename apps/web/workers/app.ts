import { createRequestHandler, RouterContextProvider, type ServerBuild } from "react-router";
import { cloudflare, type ExecutionCtx } from "../app/context";
import type { Env } from "../app/env";

// The whole server. React Router owns routing, so this file exists only to hand
// workerd's (request, env, ctx) to the handler and to put `env` where loaders
// can reach it.

const handle = createRequestHandler(
  // The virtual module's namespace is the build; only its public members are
  // declared in vite-env.d.ts, so the cast stands in for the rest.
  () => import("virtual:react-router/server-build") as unknown as Promise<ServerBuild>,
  import.meta.env.MODE
);

export default {
  fetch(request: Request, env: Env, ctx: ExecutionCtx): Response | Promise<Response> {
    const context = new RouterContextProvider();
    context.set(cloudflare, { env, ctx });
    return handle(request, context);
  }
};
