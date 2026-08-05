import type { LoaderFunctionArgs } from "react-router";
import { apiFetch } from "../api.server";
import { cloudflare } from "../context";

export async function loader({ request, params, context }: LoaderFunctionArgs): Promise<Response> {
  const env = context.get(cloudflare).env;
  const id = params.id as string;
  const upstream = await apiFetch(`/v1/axis/documents/${encodeURIComponent(id)}/file`, { env, request });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": upstream.headers.get("content-disposition") ?? "inline",
      "cache-control": "no-store"
    }
  });
}
