/**
 * A cleared SIGNAL creative rendered as the post itself.
 *
 * The studio could write the words and never show the thing a marketer
 * actually publishes, so a "social" variant read as a paragraph in a form
 * field. This turns that paragraph into a branded card at the three sizes the
 * networks take, from the tenant's own brand config (CLAUDE.md §5) — no
 * hard-coded product name, no hard-coded accent.
 *
 * It emits an SVG string rather than JSX on purpose: the studio preview and the
 * download route render the *same* bytes, so what the screen shows is what the
 * file contains. Standalone SVG cannot carry the app's webfonts, so the stacks
 * below name real families and fall back to system-ui — an Arabic post gets the
 * Arabic face first, same order as tokens.css.
 */

/** The three frames every network accepts: feed, portrait feed, full-screen. */
export const POST_RATIOS = {
  square: { w: 1080, h: 1080 },
  portrait: { w: 1080, h: 1350 },
  story: { w: 1080, h: 1920 }
} as const;

export type PostRatio = keyof typeof POST_RATIOS;

// `| undefined` on every optional is deliberate: the repo runs
// exactOptionalPropertyTypes, and every caller reads these straight off a
// partial brand record where the property may be absent.
export interface PostCardInput {
  headline: string;
  body?: string | undefined;
  /** Campaign or objective — the small line above the headline. */
  kicker?: string | undefined;
  /** `brand.name`; never a literal (CLAUDE.md §5). */
  brandName: string;
  /** `brand.palette.accent`; falls back to the product's own vega-500. */
  accent?: string | undefined;
  /** `brand.palette.accentContrast` — what sits legibly ON the accent. */
  accentContrast?: string | undefined;
  ratio?: PostRatio | undefined;
  locale?: string | undefined;
}

const INK = "#0b0e13";
const INK_UP = "#161c28";
const PAPER = "#edf1f7";
const MUTED = "#aeb6c6";
const VEGA = "#c8f163";

const LATIN = "Archivo, 'Instrument Sans', system-ui, sans-serif";
const ARABIC = "'IBM Plex Sans Arabic', 'Instrument Sans', system-ui, sans-serif";

/** SVG is XML: an unescaped `&` or `<` in tenant copy is a broken file. */
export const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&apos;"
  );

/**
 * Greedy word wrap. SVG has no line box, so the caller has to break the text
 * itself; `perLine` is a character budget derived from the font size, which is
 * close enough for display copy and needs no font metrics.
 * ponytail: measure glyphs only if a real face lands wildly off.
 */
export function wrap(text: string, perLine: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= perLine) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  const last = lines[maxLines - 1];
  if (last !== undefined && text.split(/\s+/).filter(Boolean).join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = `${last.replace(/[.,;:]$/, "")}…`;
  }
  return lines;
}

/** Long copy gets a smaller face rather than a card that overflows. */
const headlineSize = (length: number): number => (length <= 42 ? 92 : length <= 90 ? 72 : 56);

export function postCardSvg(input: PostCardInput): string {
  const { w, h } = POST_RATIOS[input.ratio ?? "square"];
  const rtl = (input.locale ?? "en").startsWith("ar");
  const family = rtl ? ARABIC : LATIN;
  const accent = input.accent || VEGA;
  const onAccent = input.accentContrast || INK;
  const pad = 88;
  const x = rtl ? w - pad : pad;
  const anchor = rtl ? "end" : "start";

  const size = headlineSize(input.headline.length);
  const perLine = Math.floor((w - pad * 2) / (size * 0.52));
  const headLines = wrap(input.headline, perLine, 4);
  const bodyLines = input.body ? wrap(input.body, Math.floor((w - pad * 2) / 15), h > 1200 ? 6 : 3) : [];

  // Headline block sits on the optical third and grows downward; body follows.
  const headTop = Math.round(h * 0.42);
  const lead = Math.round(size * 1.14);
  const bodyTop = headTop + headLines.length * lead + 44;

  const line = (text: string, dy: number, cls: string) =>
    `<text x="${x}" y="${dy}" class="${cls}">${esc(text)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(input.headline)}" direction="${rtl ? "rtl" : "ltr"}">
<defs>
<linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${INK_UP}"/><stop offset="1" stop-color="${INK}"/></linearGradient>
<radialGradient id="glow" cx="${rtl ? "0.85" : "0.15"}" cy="0.12" r="0.75"><stop offset="0" stop-color="${accent}" stop-opacity="0.34"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
<style>
text { font-family: ${family}; }
.kicker { fill: ${accent}; font-size: 30px; letter-spacing: 4px; text-transform: uppercase; }
.head { fill: ${PAPER}; font-size: ${size}px; font-weight: 700; }
.body { fill: ${MUTED}; font-size: 34px; }
.brand { fill: ${onAccent}; font-size: 32px; font-weight: 700; }
</style>
</defs>
<rect width="${w}" height="${h}" fill="url(#ground)"/>
<rect width="${w}" height="${h}" fill="url(#glow)"/>
<rect x="${rtl ? w - pad - 6 : pad}" y="${headTop - size - 40}" width="6" height="${size + 8}" fill="${accent}"/>
<g text-anchor="${anchor}">
${input.kicker ? line(input.kicker, headTop - size - 6, "kicker") : ""}
${headLines.map((text, i) => line(text, headTop + i * lead, "head")).join("\n")}
${bodyLines.map((text, i) => line(text, bodyTop + i * 48, "body")).join("\n")}
</g>
<rect x="0" y="${h - 132}" width="${w}" height="132" fill="${accent}"/>
<g text-anchor="${anchor}"><text x="${x}" y="${h - 52}" class="brand">${esc(input.brandName)}</text></g>
</svg>`;
}
