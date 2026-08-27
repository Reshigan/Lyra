import type { LoaderFunctionArgs } from "react-router";
import { proxyFile } from "../api.server";
import { cloudflare } from "../context";

export async function loader({ request, params, context }: LoaderFunctionArgs): Promise<Response> {
  const env = context.get(cloudflare).env;
  const id = params.id as string;
  return proxyFile(`/v1/axis/documents/${encodeURIComponent(id)}/file`, { env, request }, "application/octet-stream");
}
