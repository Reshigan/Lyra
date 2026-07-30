import { renderToReadableStream } from "react-dom/server";
import { ServerRouter, type EntryContext } from "react-router";
import { isbot } from "isbot";

// Workers has no Node streams; react-dom's web-stream renderer is the one that
// runs here. Crawlers get the whole document, people get it as it comes.

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext
): Promise<Response> {
  let status = responseStatusCode;
  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      onError(error: unknown) {
        status = 500;
        console.error(error);
      }
    }
  );

  if (isbot(request.headers.get("user-agent") ?? "")) await body.allReady;

  responseHeaders.set("content-type", "text/html; charset=utf-8");
  return new Response(body, { status, headers: responseHeaders });
}
