# ADR-0045: Depth is lightness and layering, not perspective

## Status

Accepted.

## Context

The brief for the go-live pass asked for screens that are "cinematic, and 3d
and motion". The motion half is unambiguous — docs/15 §3 specifies the curves,
the durations, the stagger, the tick and the reduced-motion parity, and the
implementation now matches it. The "3d" half is not, and it collides with two
decisions already on the record:

- **ADR-0031** chose depth-by-lightness for the dark theme. `tokens.css:365-367`
  sets `--elev: none; --elev2: none;` outright: a surface rises by moving up the
  ink ramp (ink-800 → ink-600) and is bounded by a 1px inner ring. The light
  theme keeps real shadows (`tokens.css:464-465`) because on a light ground a
  lighter surface cannot read as nearer.
- **docs/15 §3** bans glass and blur by name, and says surfaces must rise "not
  shadow soup". It also says "motion is garnish, never information".

The literal reading of "3d" — CSS `perspective`, `rotateX/Y` on cards, parallax
tilt following the pointer — would satisfy the word and break both. It also
fails on the substance: a tilted card has a near edge and a far edge, so its
text is at two different effective sizes and its contrast against the ground
varies across its own surface. That is a WCAG 2.2 AA problem (CLAUDE.md §8,
contrast ≥ 4.5:1 for body text) that no token can fix, because the ratio stops
being a property of the token pair and becomes a property of the rotation.
`packages/ui/src/contrast.test.ts` checks literal hex pairs; it would keep
passing while the rendered screen failed.

There is also a plainer objection. Every LYRA surface is a working surface —
an underwriter reading a schedule, a claims handler moving a case, a controller
reconciling a period. Tilting the thing someone is reading is a cost paid by
the person doing the work, for an effect that is over after the first look.

## Decision

Depth on LYRA is built from four things, none of which is perspective:

1. **The lightness ramp.** Nearer surfaces are lighter in dark theme, shadowed
   in light theme. Already shipped; unchanged by this ADR.
2. **The hairline.** A 1px border where a lesser design puts a drop shadow —
   `Hairline` and `Panel` in `packages/ui/src/horizon.tsx`.
3. **Real z-layering in the shell.** The chrome, the rail and the status bar sit
   on their own layer and *hold still* while the workspace crossfades beneath
   them. This is what actually reads as dimensional, and it is now implemented
   as View Transitions (`apps/web/app/app.css`, the `lyra-chrome` / `lyra-rail`
   / `lyra-status` / `lyra-workspace` names, opted into by
   `apps/web/app/components/shell.tsx`).
4. **Motion that respects the layers.** Entrances rise 2px on
   `--ease-observatory`; a changed figure ticks once on `--ease-settle`; charts
   draw once per mount. Nothing loops, nothing tracks the pointer.

We do **not** add: `perspective`, `transform-style: preserve-3d`, rotation on
content surfaces, pointer-tracking tilt, parallax scroll on text, or any
WebGL/canvas depth layer. No new dependency was added for any of the above, and
none is warranted.

The one place a literal third dimension is permitted is data-visualisation
where the third axis carries data — a density map, a surface plot — consistent
with docs/15 §3 already allowing gradients there and nowhere else. Such a
surface still needs its values readable without the depth cue.

## Consequences

- The "3d" ask is honoured as spatial layering rather than simulated
  perspective. Anyone expecting card-tilt will not find it, and this ADR is the
  answer to why.
- ADR-0031's shadow-free dark theme and docs/15 §3's glass ban stand unamended.
- Contrast stays a property of token pairs, so `contrast.test.ts` remains a
  real gate rather than a partial one.
- Reduced-motion parity is achievable, because every depth cue here is either
  static (lightness, hairline) or already disabled under
  `prefers-reduced-motion` (`tokens.css:785-793` plus the View Transitions
  override in `app.css`).
- If a future surface genuinely needs perspective — a 3D risk-surface plot in
  NORTH is the plausible case — it supersedes this ADR rather than bending it.
