import { readFileSync, writeFileSync } from "node:fs";
import { SECRET_CACHE_PATH } from "./env.js";

// ponytail: a JSON file, not an in-process variable — 01-sign-in-enrol and
// 04-returning-sign-in are separate Jest test files (separate module
// instances), and the enrolment secret only exists once, on screen, during
// 01's run. This is the entire reason the five specs run in file-name order
// (jest's default) rather than independently; see e2e/README.md.
export function saveSecret(secret: string): void {
  writeFileSync(SECRET_CACHE_PATH, JSON.stringify({ secret }));
}

export function loadSecret(): string {
  const { secret } = JSON.parse(readFileSync(SECRET_CACHE_PATH, "utf8")) as { secret: string };
  return secret;
}
