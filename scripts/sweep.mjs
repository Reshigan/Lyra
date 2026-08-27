// Walks every static route as a signed-in reader and greps the rendered `main`
// for text that is not prose. SWEEP_BASE picks the environment; default is
// production. Read-only by construction — it never submits a form.
//
// Anything with a :param is scripts/sweep-detail.mjs's job. The shared parts —
// sign-in, checks, per-route verdict — live in sweep-lib.mjs.
//
//   node scripts/sweep.mjs
//   SWEEP_BASE=https://staging.lyra.vantax.co.za node scripts/sweep.mjs
import { chromium } from "@playwright/test";
import { BASE, routePatterns, signIn, sweepRoute, report } from "./sweep-lib.mjs";

const ROUTES = routePatterns({ param: false });
if (!ROUTES.includes("/")) ROUTES.unshift("/");

console.log(`sweeping ${ROUTES.length} routes on ${BASE}\n`);

const browser = await chromium.launch();
const page = await browser.newPage();
await signIn(page);

const tally = { ok: 0, hit: 0, bad: 0, denied: 0 };
for (const path of ROUTES) tally[await sweepRoute(page, path)]++;

await browser.close();
process.exit(report("routes", ROUTES.length, tally) ? 1 : 0);
