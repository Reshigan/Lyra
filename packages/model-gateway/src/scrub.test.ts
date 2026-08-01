import { describe, expect, it } from "vitest";
import { newScrubState, rehydrate, scrub, scrubMessages } from "./scrub.js";

// Luhn-valid card numbers of exactly 13 / 16 / 19 digits (all zero-check-digit
// variants of a repeated "4"), and the length-14 has-no-relevance boundary.
const CARD_13 = "4444444444448"; // 13 digits, valid
const CARD_16 = "4111111111111111"; // 16 digits, valid (well-known test PAN)
const CARD_19 = "4444444444444444442"; // 19 digits, valid
const CARD_16_BAD_LUHN = "4111111111111112"; // 16 digits, checksum fails
const CARD_12_TOO_SHORT = "444444444442"; // 12 digits — below CARD regex's own 13 minimum

describe("scrub — CARD / luhn", () => {
  // Note: the CARD regex's trailing `[ -]?` is part of its last repetition,
  // so it greedily swallows one separator character after the final digit —
  // hence no space between [[CARD_1]] and the following word below.
  it("redacts a 13-digit Luhn-valid card as [[CARD_1]] and flags pii_card", () => {
    const { text, flags } = scrub(`card ${CARD_13} on file`);
    expect(text).toBe("card [[CARD_1]]on file");
    expect(flags).toContain("pii_card");
  });

  it("redacts a 16-digit Luhn-valid card", () => {
    const { text } = scrub(`pan ${CARD_16} exp 12/30`);
    expect(text).toBe("pan [[CARD_1]]exp 12/30");
  });

  it("redacts a 19-digit Luhn-valid card (upper length boundary)", () => {
    const { text } = scrub(`long pan ${CARD_19} here`);
    expect(text).toBe("long pan [[CARD_1]]here");
  });

  it("leaves a 16-digit number with a bad checksum unredacted", () => {
    const { text, flags } = scrub(`pan ${CARD_16_BAD_LUHN} exp 12/30`);
    expect(text).toBe(`pan ${CARD_16_BAD_LUHN} exp 12/30`);
    expect(flags).not.toContain("pii_card");
  });

  it("never even reaches luhn for a 12-digit run — CARD regex requires 13+", () => {
    const { text, flags } = scrub(`ref ${CARD_12_TOO_SHORT} done`);
    expect(text).toBe(`ref ${CARD_12_TOO_SHORT} done`);
    expect(flags).toHaveLength(0);
  });

  it("rehydrates a scrubbed card back to the original PAN", () => {
    const { text, map } = scrub(`card ${CARD_16}`);
    expect(rehydrate(text, map)).toBe(`card ${CARD_16}`);
  });
});

describe("scrub — secrets", () => {
  it("redacts a Cloudflare API token and flags secret_in_prompt, not pii", () => {
    const { text, flags } = scrub("token cfat_ABCDEFGHIJKLMNOPQRST12 here");
    expect(text).toBe("token [[REDACTED]] here");
    expect(flags).toEqual(["secret_in_prompt"]);
  });

  it("redacts an Anthropic key", () => {
    const { text, flags } = scrub("key sk-ant-ABCDEFGHIJKLMNOPQRST12 end");
    expect(text).toBe("key [[REDACTED]] end");
    expect(flags).toEqual(["secret_in_prompt"]);
  });

  it("redacts an OpenAI-shaped key that does not start with sk-ant-", () => {
    const { text, flags } = scrub("key sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 end");
    expect(text).toBe("key [[REDACTED]] end");
    expect(flags).toEqual(["secret_in_prompt"]);
  });

  it("redacts an AWS access key id (exact 16-char suffix)", () => {
    const { text, flags } = scrub("id AKIAABCDEFGHIJKLMNOP done");
    expect(text).toBe("id [[REDACTED]] done");
    expect(flags).toEqual(["secret_in_prompt"]);
  });

  it("redacts a Bearer token", () => {
    const { text, flags } = scrub("Authorization: Bearer ABCDEFGHIJKLMNOPQRST1234");
    expect(text).toBe("Authorization: [[REDACTED]]");
    expect(flags).toEqual(["secret_in_prompt"]);
  });

  it("redacts a PEM private key block", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END RSA PRIVATE KEY-----";
    const { text, flags } = scrub(`key:\n${pem}\ndone`);
    expect(text).toBe("key:\n[[REDACTED]]\ndone");
    expect(flags).toEqual(["secret_in_prompt"]);
  });

  it("redacts a 3-part JWT", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const { text, flags } = scrub(`auth ${jwt} end`);
    expect(text).toBe("auth [[REDACTED]] end");
    expect(flags).toEqual(["secret_in_prompt"]);
  });

  it("does not double-flag or leak the secret into the map (nothing to rehydrate)", () => {
    const { map } = scrub("token cfat_ABCDEFGHIJKLMNOPQRST12 here");
    expect(map.size).toBe(0);
  });
});

describe("scrub — PII", () => {
  it("redacts an email and flags pii_email", () => {
    const { text, flags, map } = scrub("contact jane.doe@example.com now");
    expect(text).toBe("contact [[EMAIL_1]] now");
    expect(flags).toContain("pii_email");
    expect(map.get("[[EMAIL_1]]")).toBe("jane.doe@example.com");
  });

  it("redacts an IBAN and flags pii_iban", () => {
    const { text, flags } = scrub("iban GB29NWBK60161331926819 please");
    expect(text).toBe("iban [[IBAN_1]] please");
    expect(flags).toContain("pii_iban");
  });

  it("redacts an Emirates ID and flags pii_emirates_id", () => {
    const { text, flags } = scrub("eid 784123412345671 on file");
    expect(text).toBe("eid [[EMIRATES_ID_1]] on file");
    expect(flags).toContain("pii_emirates_id");
  });

  it("redacts an international phone number and flags pii_phone", () => {
    const { text, flags } = scrub("call +12345678901 today");
    expect(text).toBe("call [[PHONE_1]] today");
    expect(flags).toContain("pii_phone");
  });

  it("redacts an IPv4 address and flags pii_ip", () => {
    const { text, flags } = scrub("from 192.168.1.1 seen");
    expect(text).toBe("from [[IP_1]] seen");
    expect(flags).toContain("pii_ip");
  });
});

describe("scrub — repeated values and counter", () => {
  it("reuses the same placeholder for a repeated value instead of incrementing", () => {
    const { text } = scrub("jane.doe@example.com wrote to jane.doe@example.com");
    expect(text).toBe("[[EMAIL_1]] wrote to [[EMAIL_1]]");
  });

  it("numbers distinct values of the same kind in order of first appearance", () => {
    const { text } = scrub("jane.doe@example.com and john.smith@example.com");
    expect(text).toBe("[[EMAIL_1]] and [[EMAIL_2]]");
  });

  it("keeps per-kind counters independent — an interleaved different kind must not shift numbering", () => {
    // Pins countOf() actually filtering by kind: a mutant that counts every
    // seen token (regardless of kind) or never counts any would turn the
    // second email into [[EMAIL_1]] or [[EMAIL_3]] instead of [[EMAIL_2]].
    const { text } = scrub("jane.doe@example.com then +12345678901 then john.smith@example.com");
    expect(text).toBe("[[EMAIL_1]] then [[PHONE_1]] then [[EMAIL_2]]");
  });
});

describe("scrub — state threading and shared ScrubState", () => {
  it("carries seen/map/flags across two calls sharing one ScrubState", () => {
    const state = newScrubState();
    const first = scrub("jane.doe@example.com", state);
    const second = scrub("jane.doe@example.com and john.smith@example.com", state);
    expect(first.text).toBe("[[EMAIL_1]]");
    expect(second.text).toBe("[[EMAIL_1]] and [[EMAIL_2]]");
    expect(second.map.size).toBe(2);
  });

  it("newScrubState returns independent, empty collections each call", () => {
    const a = newScrubState();
    const b = newScrubState();
    a.flags.add("pii_email");
    expect(b.flags.size).toBe(0);
    expect(a.map).not.toBe(b.map);
  });
});

describe("rehydrate", () => {
  it("returns the text unchanged when the map is empty", () => {
    expect(rehydrate("hello [[EMAIL_1]]", new Map())).toBe("hello [[EMAIL_1]]");
  });

  it("substitutes a known placeholder with its original value", () => {
    const map = new Map([["[[EMAIL_1]]", "jane.doe@example.com"]]);
    expect(rehydrate("hi [[EMAIL_1]], welcome", map)).toBe("hi jane.doe@example.com, welcome");
  });

  it("leaves an unknown placeholder-shaped token alone", () => {
    const map = new Map([["[[EMAIL_1]]", "jane.doe@example.com"]]);
    expect(rehydrate("hi [[EMAIL_9]]", map)).toBe("hi [[EMAIL_9]]");
  });

  it("matches a multi-digit counter in full, not just its first digit", () => {
    // Pins the \d+ quantifier: a mutant narrowing it to a single \d would
    // only consume the "1" of "12" and leave a stray "2]]" in the output.
    const map = new Map([["[[EMAIL_12]]", "jane.doe@example.com"]]);
    expect(rehydrate("hi [[EMAIL_12]] there", map)).toBe("hi jane.doe@example.com there");
  });

  it("rehydrates every occurrence when the same placeholder repeats", () => {
    const map = new Map([["[[EMAIL_1]]", "jane.doe@example.com"]]);
    expect(rehydrate("[[EMAIL_1]] emailed [[EMAIL_1]]", map)).toBe(
      "jane.doe@example.com emailed jane.doe@example.com"
    );
  });
});

describe("scrubMessages", () => {
  it("scrubs every message and shares one placeholder map across all of them", () => {
    const { messages, map, flags } = scrubMessages([
      { content: "email me at jane.doe@example.com", role: "user" },
      { content: "sure, jane.doe@example.com noted", role: "assistant" }
    ]);
    expect(messages[0]!.content).toBe("email me at [[EMAIL_1]]");
    expect(messages[1]!.content).toBe("sure, [[EMAIL_1]] noted");
    expect(messages[0]!.role).toBe("user");
    expect(map.get("[[EMAIL_1]]")).toBe("jane.doe@example.com");
    expect(flags).toContain("pii_email");
  });

  it("returns an empty map and flags for messages with nothing to scrub", () => {
    const { messages, map, flags } = scrubMessages([{ content: "hello there", role: "user" }]);
    expect(messages[0]!.content).toBe("hello there");
    expect(map.size).toBe(0);
    expect(flags).toHaveLength(0);
  });
});
