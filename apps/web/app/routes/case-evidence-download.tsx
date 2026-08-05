import type { LoaderFunctionArgs } from "react-router";
import { apiFetch, fileProxyHeaders } from "../api.server";
import { cloudflare } from "../context";

// A pure byte proxy: the browser can't read the session cookie (httpOnly), so
// a plain <a href> to apps/api would 401. This loader forwards the cookie
// server-side (api.server.ts's apiFetch) and streams the response straight
// through — same "server-side by design" shape as every other loader here.

export async function loader({ request, params, context }: LoaderFunctionArgs): Promise<Response> {
  const env = context.get(cloudflare).env;
  const bundleId = params.bundleId as string;
  const upstream = await apiFetch(`/v1/compliance/evidence-bundles/${encodeURIComponent(bundleId)}/download`, { env, request });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: fileProxyHeaders(upstream, "application/zip")
  });
}
