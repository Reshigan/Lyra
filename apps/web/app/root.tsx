import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useNavigation,
  useRouteError,
  useRouteLoaderData,
  type LinksFunction,
  type LoaderFunctionArgs
} from "react-router";
import { UiTextProvider } from "@lyra/ui";
import "./app.css";
import { DEFAULT_LOCALE, dirFor, langFor, localeFrom, readCookie, translator } from "./i18n";

// Only the two first-paint faces (packages/ui/FONTS.md §Preload; ADR-0026).
// The mono, the four Arabic cuts, and Instrument Serif are discovered when
// they first match an element — preloading them would fetch bytes most page
// loads never render. `crossOrigin` is mandatory even same-origin: fonts are
// fetched in CORS mode, and a preload without it is a second, unused request.
export const links: LinksFunction = () => [
  {
    rel: "preload",
    href: "/fonts/instrument-sans-latin-wght-normal.woff2",
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous"
  },
  {
    rel: "preload",
    href: "/fonts/archivo-latin-wght-normal.woff2",
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous"
  }
];

// The document. Locale is resolved here rather than in the shell so that the
// login page — which has no session and therefore no profile — still renders in
// the right direction on the first frame.

/**
 * Horizon is two palettes, not one behind a filter (tokens.css): daylight is a
 * white page with no starfield, night is the deep field. Resolving the choice on
 * the server is the whole point — a client-side flip flashes the wrong palette
 * on every navigation. Dark is the product default (docs/01-brand.md: "dark-
 * first"): absent a cookie, every visitor gets dark regardless of OS
 * preference, until they opt into light via the toggle.
 */
function themeFrom(request: Request): "dark" | "light" {
  const theme = readCookie(request.headers.get("cookie"), "lyra_theme");
  return theme === "light" ? "light" : "dark";
}

export function loader({ request }: LoaderFunctionArgs) {
  return { locale: localeFrom(request), theme: themeFrom(request) };
}

export function Layout({ children }: { children: React.ReactNode }) {
  // Undefined while the root loader itself is failing; the document still has
  // to render, so fall back rather than throw a second time.
  const data = useRouteLoaderData<typeof loader>("root");
  const locale = data?.locale ?? DEFAULT_LOCALE;

  return (
    <html lang={langFor(locale)} dir={dirFor(locale)} data-theme={data?.theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen bg-bg text-text antialiased">
        {/* One locale for every @lyra/ui surface below: kit chrome, <Money>,
            <DateTime>. Without it the kit formats in English under an Arabic
            document, and 98 Table call sites each have to remember a prop. */}
        <UiTextProvider locale={locale}>{children}</UiTextProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  // Every route already handles its own local pending state (busy buttons,
  // disabled forms); this is the one cue that isn't per-screen — the shell
  // notices the navigation itself, not what it's waiting on.
  const navigation = useNavigation();
  return (
    <>
      {navigation.state !== "idle" ? <div aria-hidden="true" className="lyra-nav-progress" /> : null}
      <Outlet />
    </>
  );
}

/**
 * What happened → what we did → what you can do, with a copyable reference
 * (docs/07 §5). No stack traces: they are in the logs, keyed by that reference.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const data = useRouteLoaderData<typeof loader>("root");
  const t = translator(data?.locale ?? DEFAULT_LOCALE);

  let messageKey = "error.generic";
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) messageKey = "error.notFound";
    else if (error.status === 403) messageKey = "error.forbidden";
    else if (error.status === 401) messageKey = "error.unauthorized";
  }
  const requestId =
    isRouteErrorResponse(error) && typeof error.data === "string" ? error.data : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-prose flex-col justify-center gap-4 p-8">
      <h1 className="font-display text-28">{t("error.title")}</h1>
      <p className="text-muted">{t(messageKey)}</p>
      {requestId ? (
        <p className="font-mono text-12 text-muted">{t("error.requestId", { id: requestId })}</p>
      ) : null}
      <p>
        <a
          className="text-accent underline underline-offset-4"
          href={typeof location === "undefined" ? "/" : location.pathname}
        >
          {t("error.retry")}
        </a>
      </p>
    </main>
  );
}
