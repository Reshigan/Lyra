import { describe, expect, it } from "vitest";
import { isSealed, openField, openFields, sealField, sealFields } from "./field-crypto.js";

// docs/12 §1: field-level encryption for national identifiers and bank details.
// The property that matters is not "the string looks scrambled" — it is that a
// dump of the column, on its own, is worth nothing: no plaintext, no repeated
// ciphertext to correlate rows by, and no way to edit a value undetected.

const KEY = "s0me-32-byte-ish-secret-from-wrangler";

describe("sealField / openField", () => {
  it("round-trips a national identifier", async () => {
    const sealed = await sealField(KEY, "784-1985-1234567-1");
    expect(sealed).not.toContain("784");
    expect(await openField(KEY, sealed)).toBe("784-1985-1234567-1");
  });

  it("gives two different ciphertexts for the same plaintext", async () => {
    // Deterministic encryption would let anyone holding the column tell which
    // two documents carry the same Emirates ID without ever breaking the key.
    const a = await sealField(KEY, "784-1985-1234567-1");
    const b = await sealField(KEY, "784-1985-1234567-1");
    expect(a).not.toBe(b);
    expect(await openField(KEY, b)).toBe(await openField(KEY, a));
  });

  it("refuses a ciphertext that was edited in the database", async () => {
    const sealed = await sealField(KEY, "784-1985-1234567-1");
    const tampered = `${sealed.slice(0, -2)}${sealed.endsWith("A") ? "B" : "A"}=`.replace("=", "");
    await expect(openField(KEY, tampered)).rejects.toThrow();
  });

  it("refuses the wrong key rather than returning rubbish", async () => {
    const sealed = await sealField(KEY, "784-1985-1234567-1");
    await expect(openField("a different secret", sealed)).rejects.toThrow();
  });

  it("recognises a sealed value and leaves anything else alone", async () => {
    expect(isSealed(await sealField(KEY, "x"))).toBe(true);
    expect(isSealed("784-1985-1234567-1")).toBe(false);
    expect(isSealed(null)).toBe(false);
  });

  it("survives arabic text and empty strings", async () => {
    expect(await openField(KEY, await sealField(KEY, "أحمد المنصوري"))).toBe("أحمد المنصوري");
    expect(await openField(KEY, await sealField(KEY, ""))).toBe("");
  });
});

describe("sealFields / openFields", () => {
  const values = { fullName: "Ahmed Al Mansoori", idNumber: "784-1985-1234567-1", expiryDate: null };

  it("seals only the named fields", async () => {
    const sealed = await sealFields(KEY, values, ["idNumber"]);
    expect(sealed.fullName).toBe("Ahmed Al Mansoori");
    expect(isSealed(sealed.idNumber)).toBe(true);
    expect(sealed.expiryDate).toBeNull();
  });

  it("does not re-seal a value that is already sealed", async () => {
    const once = await sealFields(KEY, values, ["idNumber"]);
    const twice = await sealFields(KEY, once, ["idNumber"]);
    expect(twice.idNumber).toBe(once.idNumber);
  });

  it("opens every sealed field and passes the rest through", async () => {
    const sealed = await sealFields(KEY, values, ["idNumber"]);
    expect(await openFields(KEY, sealed)).toEqual(values);
  });
});
