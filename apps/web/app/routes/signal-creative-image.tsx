import type { LoaderFunctionArgs } from "react-router";
import { apiFetch, fileProxyHeaders } from "../api.server";
import { cloudflare } from "../context";

export async function loader({ request, params, context }: LoaderFunctionArgs): Promise<Response> {
  const env = context.get(cloudflare).env;
  const id = params.id as string;
  const upstream = await apiFetch(`/v1/signal/creatives/${encodeURIComponent(id)}/image`, { env, request });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: fileProxyHeaders(upstream, "image/png")
  });
}
