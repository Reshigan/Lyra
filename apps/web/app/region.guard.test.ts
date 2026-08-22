import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// How a tenant's dates and money are *written* is one decision — the calendar,
// the zone — and it is made by a provider mounted above a whole shell, not by a
// prop remembered at each of ~124 <DateTime>/<Money> call sites.
//
// The caller-by-caller version was already wrong when this guard was written:
// UiCalendarProvider was mounted in workspace.tsx alone, so a tenant on
// `islamic-umalqura` read Hijri dates in the classic workspace and Gregorian
// ones in all five module shells. It tested green because nothing asserted the
// mount, only the formatting. So the assertion here is not about formatting: it
// is that every layout that owns a shell mounts the one provider component.
//
// Both halves of each check matter. A scan for offenders that finds no files to
// scan passes forever, which is how a seam goes dead — so each test first
// proves it still has something to guard.

const APP = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

const rel = (path: string) => path.slice(APP.length + 1);

describe("regional providers", () => {
  /** Every route that renders a shell chrome: the five module forks + the classic one. */
  const layouts = [
    ...readdirSync(`${APP}/routes`).filter((name) => /-shell\.tsx$/.test(name)),
    "workspace.tsx"
  ].map((name) => `${APP}/routes/${name}`);

  it("finds the shell layouts it is meant to be guarding", () => {
    // Six today: axis, orbit, signal, scout, north, workspace. A seventh module
    // fork lands in this list the moment its route file exists, and then has to
    // satisfy the next test — which is the point of counting them here.
    expect(layouts.length).toBeGreaterThanOrEqual(6);
    expect(layouts.map(rel)).toContain("routes/workspace.tsx");
  });

  it("mounts SessionRegion in every shell layout", () => {
    const missing = layouts.filter((file) => !/<SessionRegion\b/.test(readFileSync(file, "utf8")));
    expect(missing.map(rel)).toEqual([]);
  });

  // A layout that reaches for a provider directly is the regression this whole
  // component exists to prevent: it gets the calendar and forgets the zone, or
  // gets both and the next provider added lands in five files instead of one.
  // Exactly two files may mount one — SessionRegion for a tenant's own
  // preferences, and root.tsx for the document, which also carries the screens
  // that have no tenant yet (login, the public ORBIT portals).
  it("leaves the provider mounts to SessionRegion and the document root", () => {
    const mount = /<Ui(?:Calendar|TimeZone)Provider\b/;
    const mounts = sources(APP).filter((file) => mount.test(readFileSync(file, "utf8")));
    expect(mounts.map(rel).sort()).toEqual(["components/region.tsx", "root.tsx"]);
  });
});

describe("time zones in source", () => {
  // "Asia/Dubai" as a default is a market baked into a code path: it fired a
  // South African broker's scheduled report on Gulf wall-clock. The zone is
  // tenant policy (packages/db/src/json.ts PolicyJson.timezone), read on the
  // web by timezoneFrom and on the API by ctx.policy.timezone.
  const IANA = /"(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+"/;

  it("names no IANA zone in a web source file", () => {
    const files = sources(APP);
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((file) => IANA.test(readFileSync(file, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("still recognises a zone when it sees one", () => {
    expect(IANA.test('timeZone: "Asia/Dubai"')).toBe(true);
    expect(IANA.test('timeZone: "Africa/Johannesburg"')).toBe(true);
    expect(IANA.test('locale: "en-AE"')).toBe(false);
  });
});
