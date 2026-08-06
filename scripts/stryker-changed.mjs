import { execSync } from "node:child_process";

/**
 * Source files under `dir` that changed since `STRYKER_SINCE` (a git ref set by
 * the `mutation` job in .github/workflows/ci.yml). Returns null when the
 * variable is unset, so a local or nightly run keeps its whole-tree globs.
 *
 * Stryker 9 has no `--since` of its own — it dropped the git-diff selector and
 * kept only `incremental`, which needs a prior full run to compare against.
 * `git diff` against the working tree is the same idea in one line.
 */
export function changedSources(dir) {
  const ref = process.env.STRYKER_SINCE;
  if (!ref) return null;
  const out = execSync(`git diff --name-only --diff-filter=ACMR ${ref} -- ${dir}`, {
    encoding: "utf8"
  });
  return out
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
}
