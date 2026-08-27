import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// docs/15 §4: every AI artifact carries the ✦ marker AND an inspectable "why".
// `AgentBadge` renders the marker unconditionally and the "why" only when it is
// given one — `why` is optional in the primitive on purpose, because a badge
// sitting in a Card whose caption already explains the AI does not need to say
// it twice. That option is exactly what rots: a new AI surface ships the chip,
// nobody notices the missing explanation, and the platform's own grammar is
// quietly half-kept.
//
// So the contract lives here rather than in the type. A badge with no `why`
// must name the element that explains for it, in a `ponytail:` comment on the
// line above — which makes the exemption a decision someone wrote down instead
// of an omission. Same shape as `spec.json-columns.test.ts` and `i18n.test.ts`:
// walk the real source, fail on the declaration rather than on a render.

const appDir = path.resolve(__dirname, "..");

const files = execFileSync("grep", ["-rl", "<AgentBadge", appDir], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"));

/** Each `<AgentBadge …>` in a file, with the line it starts on and the comment above it. */
function badges(file: string): Array<{ line: number; text: string; preceding: string }> {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  const found: Array<{ line: number; text: string; preceding: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]?.includes("<AgentBadge")) continue;
    // The tag may wrap over several lines; read to its close.
    let text = "";
    for (let j = i; j < lines.length && j < i + 12; j++) {
      text += lines[j];
      if (lines[j]?.includes("/>") || lines[j]?.trimEnd().endsWith(">")) break;
    }
    // Comments run upward from the tag: take the contiguous block above it.
    let preceding = "";
    for (let j = i - 1; j >= 0; j--) {
      const above = lines[j]?.trim() ?? "";
      if (!above.startsWith("//") && !above.startsWith("*") && !above.startsWith("/*")) break;
      preceding = `${above}\n${preceding}`;
    }
    found.push({ line: i + 1, text, preceding });
  }
  return found;
}

describe("every AgentBadge explains itself", () => {
  it("scans the screens that render one", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("passes a why, or says in a ponytail comment what explains instead", () => {
    const silent: string[] = [];
    for (const file of files) {
      for (const badge of badges(file)) {
        if (badge.text.includes("why=")) continue;
        if (/ponytail:/.test(badge.preceding)) continue;
        silent.push(`${path.relative(appDir, file)}:${badge.line}`);
      }
    }
    expect(silent).toEqual([]);
  });
});
