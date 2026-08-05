# Fonts — provenance and rebuild instructions

The `@font-face` block lives in `src/tokens.css`, directly above the
`--font-display` / `--font-ui` / `--font-mono` / `--font-arabic` tokens it feeds,
so a family token can never name a face nobody loads.

The files themselves live in **`apps/web/public/fonts/`**. Vite copies `public/`
into `build/client/`, and `apps/web/wrangler.jsonc` points its `assets` binding
at `./build/client/`, so `/fonts/<name>.woff2` is served by the Worker itself.

## Why self-hosted and not a CDN

Three independent reasons, any one of which is sufficient:

1. `docs/02 §9` pins the approved third-party list. A font CDN is not on it, and
   adding one needs an ADR.
2. The on-prem deployment in `ops/` may be air-gapped. A remote font host would
   render that install brand-broken.
3. It is a third-party request on every page load in a product with explicit
   compliance obligations.

## What ships, and why exactly this

Weights in use across `apps/web` and `packages/ui` are **400, 500, 600, 700**
(`font-normal`/`weight-regular`, `font-medium`/`weight-medium`,
`font-semibold`/`weight-semibold`, `font-bold`/`weight-bold`).

Space Grotesk and Inter are ADR-0026's predecessor faces, kept vendored but no
longer wired into `--font-display`/`--font-ui` (superseded by Archivo /
Instrument Sans below); left in place rather than deleted in case a tenant
override still names them via `brand.font`.

| Family | Role | File | Subset | Weights | Bytes |
| --- | --- | --- | --- | --- | --- |
| Archivo Variable | `--font-display` | `archivo-latin-wght-normal.woff2` | latin | 100–900 (axis) | 34,928 |
| Instrument Sans Variable | `--font-ui` | `instrument-sans-latin-wght-normal.woff2` | latin | 400–700 (axis) | 30,092 |
| Instrument Serif | `--font-serif` | `instrument-serif-latin-400-normal.woff2` | latin | 400 | 21,032 |
| Instrument Serif | `--font-serif` | `instrument-serif-latin-400-italic.woff2` | latin | 400 (italic) | 22,128 |
| IBM Plex Mono | `--font-mono` | `ibm-plex-mono-latin-400-normal.woff2` | latin | 400 | 14,708 |
| IBM Plex Sans Arabic | `--font-arabic` | `ibm-plex-sans-arabic-arabic-400-normal.woff2` | arabic | 400 | 42,848 |
| IBM Plex Sans Arabic | `--font-arabic` | `ibm-plex-sans-arabic-arabic-500-normal.woff2` | arabic | 500 | 45,296 |
| IBM Plex Sans Arabic | `--font-arabic` | `ibm-plex-sans-arabic-arabic-600-normal.woff2` | arabic | 600 | 45,688 |
| IBM Plex Sans Arabic | `--font-arabic` | `ibm-plex-sans-arabic-arabic-700-normal.woff2` | arabic | 700 | 44,280 |
| Space Grotesk Variable | unwired (legacy) | `space-grotesk-latin-wght-normal.woff2` | latin | 300–700 (axis) | 22,288 |
| Inter Variable | unwired (legacy) | `inter-latin-wght-normal.woff2` | latin | 100–900 (axis) | 48,256 |

Because of the `unicode-range` split, a Latin-only page on the current stack
downloads at most **101,760 bytes** (Archivo + Instrument Sans + Plex Mono,
Instrument Serif fetched only where `--font-serif` is actually used — Login
hero + dashboard headline); the 178,112 bytes of Arabic are fetched only when
Arabic codepoints are actually rendered.

Notes on the selection:

- Archivo and Instrument Sans are **variable**. One file spans the whole weight
  axis; four static cuts would cost roughly 3x these bytes.
- Instrument Serif ships **two static files, normal + italic** (ADR-0026):
  Login hero + dashboard headline only, 5 occurrences in the mockup. Not wired
  into `--font-display`/`--font-ui` — reached only via `--font-serif`, so no
  other surface can pick it up by accident.
- IBM Plex Mono ships **400 only** — no surface bolds the mono face.
- IBM Plex Sans Arabic has **no upstream variable build**, hence four static
  files. It is the Arabic fallback inside *both* `--font-display` and
  `--font-ui`, so it carries headings and body text in `ar`; dropping a cut would
  hand ar-locale readers synthetic bold.
- IBM Plex Sans Arabic ships the **Arabic range only**. It is first in the
  `--font-arabic` stack, but Latin codepoints deliberately fall through to
  Instrument Sans, which saves ~4x19 kB of redundant Latin coverage.
- `format("woff2")` only. Every browser this product targets supports woff2; a
  woff/ttf fallback would double asset weight for nobody.
- `font-display: swap` on every face — a blocked font must never blank text.
- No surface uses italics outside `--font-serif`, so no other family ships one.

## Licences

All six families are **SIL Open Font License 1.1**. OFL requires the licence to
travel with the font, so it is committed alongside the files:

- `apps/web/public/fonts/LICENSE-archivo.txt`
- `apps/web/public/fonts/LICENSE-instrument-sans.txt`
- `apps/web/public/fonts/LICENSE-instrument-serif.txt`
- `apps/web/public/fonts/LICENSE-space-grotesk.txt`
- `apps/web/public/fonts/LICENSE-inter.txt`
- `apps/web/public/fonts/LICENSE-ibm-plex-mono.txt`
- `apps/web/public/fonts/LICENSE-ibm-plex-sans-arabic.txt`

## How to re-obtain or upgrade

Sourced from Fontsource **5.3.0** (which repackages the upstream Google Fonts
builds). No dependency is added to the repo — the files are vendored, and the
packages are only unpacked in a scratch directory:

```sh
npm pack @fontsource-variable/archivo @fontsource-variable/instrument-sans \
         @fontsource/instrument-serif @fontsource-variable/space-grotesk \
         @fontsource-variable/inter @fontsource/ibm-plex-mono \
         @fontsource/ibm-plex-sans-arabic
# unpack each .tgz; the woff2 files are under package/files/
# copy the files named in the table above into apps/web/public/fonts/
# copy each package/LICENSE to LICENSE-<family>.txt
```

The `unicode-range` values in `tokens.css` are copied verbatim from the matching
Fontsource stylesheets (`wght.css` for the variable families, `400.css` for the
static ones). If you re-vendor from a newer Fontsource release, re-copy the
ranges too — Google periodically re-cuts the subsets.

## Preload

`apps/web/app/root.tsx` exports `links` and preloads exactly two faces —
Instrument Sans (`--font-ui`) and Archivo (`--font-display`) — saving roughly
one round trip on the faces that paint first:

```ts
export const links: LinksFunction = () => [
  { rel: "preload", href: "/fonts/instrument-sans-latin-wght-normal.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
  { rel: "preload", href: "/fonts/archivo-latin-wght-normal.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" }
];
```

Only those two. Preloading the mono, the Arabic cuts, or Instrument Serif
would fetch bytes most page loads never use, which is worse than preloading
nothing — Instrument Serif in particular is Login/dashboard-headline only.

`crossOrigin: "anonymous"` is not optional even though the files are same-origin:
fonts are always fetched in CORS mode, and a preload whose mode does not match
is fetched twice. The type is `LinksFunction` from `react-router` rather than
`Route.LinksFunction` — this app does not commit typegen output, and the rest of
`root.tsx` types itself the same way.
