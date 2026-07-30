// ULID (Crockford base32, monotonic within a millisecond).
// Hand-rolled rather than a dependency: 30 lines, works identically on Workers,
// Node and React Native, and keeps the M0 dependency list to the spec's.

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32, no I L O U
const TIME_LEN = 10;
const RANDOM_LEN = 16;

let lastTime = -1;
let lastRandom: number[] = [];

function encodeTime(now: number): string {
  let out = "";
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = now % 32;
    out = ENCODING[mod] + out;
    now = (now - mod) / 32;
  }
  return out;
}

function randomBytes(len: number): number[] {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b % 32);
}

/** Increment the random component so IDs stay sortable inside one millisecond. */
function bumpRandom(prev: number[]): number[] {
  const next = prev.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i]! < 31) {
      next[i] = next[i]! + 1;
      return next;
    }
    next[i] = 0;
  }
  // Overflowed a whole millisecond of IDs: start a fresh random suffix.
  return randomBytes(RANDOM_LEN);
}

export function ulid(seedTime?: number): string {
  const now = seedTime ?? Date.now();
  if (now === lastTime) {
    lastRandom = bumpRandom(lastRandom);
  } else {
    lastTime = now;
    lastRandom = randomBytes(RANDOM_LEN);
  }
  return encodeTime(now) + lastRandom.map((n) => ENCODING[n]).join("");
}

/** Prefixed id, e.g. `id("cs")` -> "cs_01J...". Prefixes are documented per table. */
export function id(prefix: string, seedTime?: number): string {
  return `${prefix}_${ulid(seedTime)}`;
}

export function ulidTime(value: string): number {
  const s = value.includes("_") ? value.slice(value.indexOf("_") + 1) : value;
  let t = 0;
  for (let i = 0; i < TIME_LEN; i++) {
    const idx = ENCODING.indexOf(s[i]!);
    if (idx < 0) throw new Error(`not a ulid: ${value}`);
    t = t * 32 + idx;
  }
  return t;
}
