// Minor units are integers everywhere in the ledger (docs/19 §9) and only the
// display layer needs to know how many of them make one major unit. That is
// this directory: the PDF, the spreadsheet and the CSV are the three places a
// number stops being an integer, so the exponent lives here rather than being
// hard-coded as `/ 100` in each of them.

/**
 * ISO 4217 minor-unit exponents that are not 2. `currency` is a free 3-letter
 * string on the wire, so JPY (0) and KWD (3) reach an export today and would
 * otherwise be shown a hundred times too small or too large.
 */
const EXPONENT: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  CLF: 4, UYW: 4
};

/** Decimal places for a currency; 2 for everything not listed, including unknown codes. */
export function minorExponent(currency: string | undefined): number {
  return EXPONENT[currency?.toUpperCase() ?? ""] ?? 2;
}

/** Minor units to major units, e.g. 120_000_00 AED → 120000, 1_234_567 KWD → 1234.567. */
export function majorUnits(minor: number, currency: string | undefined): number {
  return minor / 10 ** minorExponent(currency);
}

/**
 * The currency a row is denominated in. A multi-currency report carries its own
 * `currency` column per row; a single-currency one states it once on the table.
 */
export function rowCurrency(row: Record<string, unknown>, table: { currency?: string }): string | undefined {
  const own = row["currency"];
  return typeof own === "string" ? own : table.currency;
}
