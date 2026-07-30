import { redirect, type ActionFunctionArgs } from "react-router";
import { cloudflare } from "../context";
import { apiFetch, relayCookies } from "../api.server";

// Action only, no UI. POST so a link prefetch or a crawler cannot end a session.

export async function action({ request, context }: ActionFunctionArgs) {
  const headers = new Headers();
  try {
    const response = await apiFetch("/v1/auth/logout", {
      env: context.get(cloudflare).env,
      request,
      method: "POST"
    });
    // The API clears the cookie; relaying it clears it in the browser too.
    relayCookies(response, headers);
  } catch {
    // A failed logout still ends the session here: leaving someone signed in
    // because the API hiccuped is the worse outcome.
    headers.append("set-cookie", "lyra_session=; Path=/; HttpOnly; Max-Age=0");
  }
  return redirect("/login", { headers });
}

/** Nothing to render; a GET goes back to the sign-in page. */
export function loader() {
  return redirect("/login");
}
