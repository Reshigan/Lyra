// The sibling of sweep.mjs, for the 38 routes behind an :id. It cannot read
// those routes off the manifest the way sweep.mjs does — `/admin/staff/:id` is
// not a URL — so it harvests real ones: walk the static routes, collect every
// `main a[href]`, and keep the hrefs that match a :param pattern.
//
// This is how sighting 4 was found (`admin.status.active` rendered raw on
// /admin/staff/:id while the list beside it translated the same column), and
// this script's uncommitted predecessor is why detail routes then went unswept
// for weeks. Harvesting beats a hard-coded id list for the same reason: the ids
// come from whatever the environment actually seeded.
//
//   node scripts/sweep-detail.mjs
//   SWEEP_BASE=https://staging.lyra.vantax.co.za node scripts/sweep-detail.mjs
import { chromium } from "@playwright/test";
import { BASE, routePatterns, signIn, sweepRoute, report } from "./sweep-lib.mjs";

const STATIC = routePatterns({ param: false });
const PARAM = routePatterns({ param: true });

// `/axis/policies/:id/detail` becomes /^\/axis\/policies\/[^/]+\/detail$/. A
// :param never spans a slash, so one segment each — which is also what keeps
// `/:module/:resource/:id` from swallowing every href on the site: it still has
// to match segment count exactly.
const MATCHERS = PARAM.map((p) => ({
  pattern: p,
  re: new RegExp(`^${p.split("/").map((s) => (s.startsWith(":") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/")}$`)
}));

const browser = await chromium.launch();
const page = await browser.newPage();
await signIn(page);

console.log(`\nharvesting hrefs from ${STATIC.length} static routes\n`);
const found = new Map(); // url -> the pattern it matched, for coverage reporting
let harvested = 0;
for (const path of STATIC) {
  // Harvest is the long phase — 76 loads at `networkidle`. Without a line per
  // route a slow run and a hung one read identically, which cost an hour once.
  process.stdout.write(`  ${++harvested}/${STATIC.length} ${path}\n`);
  const hrefs = await page
    .goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 45_000 })
    .then(() => page.locator("main a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href"))))
    .catch(() => []);
  for (const href of hrefs) {
    if (!href?.startsWith("/")) continue; // external and #anchors are not ours
    const url = href.split(/[?#]/)[0];
    if (found.has(url)) continue;
    const m = MATCHERS.find(({ re }) => re.test(url));
    if (m) found.set(url, m.pattern);
  }
}

const covered = new Set(found.values());
const unreached = MATCHERS.filter(({ pattern }) => !covered.has(pattern)).map((m) => m.pattern);
console.log(`\n${found.size} detail URLs across ${covered.size}/${PARAM.length} param routes`);
// A pattern no link reaches is not swept, and silence would read as a pass. It
// is usually a screen linked only from a detail route (one hop deeper than this
// harvest goes) or one whose list is empty in this environment's seed.
if (unreached.length) console.log(`unreached patterns: ${unreached.join(", ")}`);
console.log("");

// A pattern renders one template, so the tenth instance of it teaches nothing
// the first three did not — and the seed has 600+ commission entries, which is
// two hours of loads to re-render the same two screens. Sweep a few per pattern
// instead: enough that a row with an empty column or a null field still shows
// up, few enough that the whole sweep is minutes.
const PER_PATTERN = Number(process.env.SWEEP_PER_PATTERN ?? 3);
const perPattern = new Map();
const sample = [...found].filter(([, pattern]) => {
  const n = (perPattern.get(pattern) ?? 0) + 1;
  perPattern.set(pattern, n);
  return n <= PER_PATTERN;
});
console.log(`sweeping ${sample.length} of ${found.size} — up to ${PER_PATTERN} per pattern\n`);

const tally = { ok: 0, hit: 0, bad: 0, denied: 0 };
for (const [url] of sample) tally[await sweepRoute(page, url)]++;

await browser.close();
process.exit(report("detail URLs", sample.length, tally) ? 1 : 0);
