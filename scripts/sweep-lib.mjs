// Shared by sweep.mjs (static routes) and sweep-detail.mjs (routes behind an
// :id). The two differ only in how they find routes; sign-in, the not-prose
// checks and the per-route verdict are identical, and the last time they were
// separate scripts the detail one was lost and its 38 routes went unswept for
// weeks. One home means a check added for one sweep is live in both.
import { readdirSync, readFileSync } from "node:fs";

export const BASE = process.env.SWEEP_BASE ?? "https://lyra.vantax.co.za";

/** Route patterns from the web manifest. `param` picks :id routes vs static. */
export function routePatterns({ param }) {
  const src = readFileSync("apps/web/app/routes.ts", "utf8");
  return [
    ...new Set(
      [...src.matchAll(/route\("([^"]+)"/g)]
        .map((m) => m[1])
        .filter((p) => p.includes(":") === param)
        .map((p) => (p.startsWith("/") ? p : `/${p}`))
        .filter((p) => p !== "/login" && p !== "/logout")
    )
  ];
}

// An untranslated key is a key from the catalogue rendered as-is, so match the
// real key set rather than the shape of one. The old regex
// (/\b[a-z][a-z0-9]*(?:\.[a-z][a-zA-Z0-9]+){2,}\b/) was wrong both ways: keys
// here are `area.thing`, two segments, so it could never match a real one, and
// it flagged every other dotted-lowercase token instead — "api.lyra.vantax.co.za"
// in a curl example, the seeded AXIS template key "group.medical.census" (whose
// display name lives in a sibling nameJson column and rendered correctly).
const I18N_KEYS = [
  ...new Set(
    [...readFileSync("apps/web/app/i18n/en.ts", "utf8").matchAll(/^\s*"([a-z][\w.]*\.[\w]+)":/gm)].map(
      (m) => m[1]
    )
  )
];
// Two ways a key reaches a screen, and neither check sees the other's case.
// A key in the catalogue printed verbatim is caught by membership. But the
// defect this check was written for — `admin.status.active` on /admin/staff/:id
// (fixed in f4dfaa4) — was a key in NO catalogue in either language, leaked by
// an unresolved lookup, so membership cannot see it. That one is caught by
// shape, narrowed to the namespaces the product actually owns: every first
// segment in the catalogue plus every module under app/modules. "admin" is
// there; "api" (api.lyra.vantax.co.za, in a curl example) and "group"
// (group.medical.census, a seeded AXIS template key whose display name lives in
// a sibling nameJson and rendered fine) are not, which is what made those three
// sweep hits false positives.
const NAMESPACES = [
  ...new Set([
    ...I18N_KEYS.map((k) => k.split(".")[0]),
    ...readdirSync("apps/web/app/modules")
      .filter((f) => f.endsWith(".ts") && !f.includes(".test.") && !f.startsWith("spec"))
      .map((f) => f.replace(/\.ts$/, ""))
  ])
].filter((n) => n !== "index");

const I18N_KEY_RE = new RegExp(
  `\\b(?:${I18N_KEYS.map((k) => k.replace(/\./g, "\\.")).join("|")}` +
    `|(?:${NAMESPACES.join("|")})(?:\\.[a-z][a-zA-Z0-9]*)+)\\b`
);

export const CHECKS = [
  [/\[object Object\]/, "[object Object]"],
  [/\bundefined\b/, "bare undefined"],
  [/\bNaN\b/, "NaN"],
  [I18N_KEY_RE, "untranslated i18n key"],
  [/[\w/-]+\/[\w-]+\.md\b/, "storage key"],
  [/\b\d{1,3},\d{3}-\d{2}-\d{2}\b/, "comma-grouped year"]
];

/**
 * The persona is the sweep's coverage. sweep.mjs signed in as amina.saleh
 * (tenant.admin) for weeks, and tenant.admin resolves to the `admin` shell and
 * nothing else — a cross-module read deliberately does not imply a shell
 * (packages/core/src/lens.ts, ADR-0054 the one named exception). So every
 * /orbit/*, /axis/*, /signal/* shell screen answered 403 and was never
 * rendered, and three `[object Object]` columns on the ORBIT routing desk sat
 * there unseen while [object Object] was already a CHECKS pattern.
 *
 * The login page's demo picker carries one persona holding all 24 roles, which
 * is the only account that reaches every shell.
 */
export async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  // The picker is a <details> shut by default (login.tsx), so its buttons are in
  // the DOM but not clickable until it is opened. Clicking one signs in with no
  // password — a demo fixture, never a live credential.
  await page.locator("details").first().evaluate((d) => (d.open = true));
  await page.locator("button[type=submit]", { hasText: "all 24 roles" }).first().click();
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30_000 });
  console.log("signed in as the all-roles demo administrator");
}

/**
 * Render one route and classify it. Returns "ok" | "hit" | "bad" | "denied" so
 * a caller can tally; a denied route is counted as unswept and never as a pass,
 * because a route nothing rendered has been checked for nothing.
 */
export async function sweepRoute(page, path) {
  let text = "";
  let status = "";
  try {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 45_000 });
    status = res?.status() ?? "?";
    text = await page.locator("main").first().innerText({ timeout: 10_000 }).catch(() => "");
  } catch (err) {
    console.log(`ERR  ${path}  ${err.message.split("\n")[0]}`);
    return "bad";
  }
  if (status === 401 || status === 403) {
    console.log(`DENIED ${path}  [${status}]  not swept — persona cannot open it`);
    return "denied";
  }
  // A crash renders an error boundary whose prose trips none of the CHECKS, so
  // /north/explorer sat in this sweep's output logged `ok [500]` — the status
  // was printed all along and only the word beside it was wrong.
  if (typeof status === "number" && status >= 500) {
    console.log(`FAIL ${path}  [${status}]  server error`);
    return "bad";
  }
  const hits = CHECKS.filter(([re]) => re.test(text)).map(([re, label]) => {
    const m = text.match(re);
    return `${label}: ${JSON.stringify(m[0].slice(0, 60))}`;
  });
  if (hits.length) {
    console.log(`HIT  ${path}  [${status}]  ${hits.join(" | ")}`);
    return "hit";
  }
  console.log(`ok   ${path}  [${status}]  ${text.length}b`);
  return "ok";
}

export function report(kind, total, tally) {
  const bad = tally.bad + tally.hit;
  console.log(
    `\n${total} ${kind}, ${bad} flagged, ${tally.denied} not swept` +
      (tally.denied ? " — a denied route proves nothing about what it renders" : "")
  );
  return bad;
}
