/**
 * The constellation mark: Lyra the harp, drawn as four charted stars with the
 * bright one — Vega — set apart in the tenant accent. Decorative, so it carries
 * no title and is hidden from the reader; the wordmark beside it is the name.
 */
export function ConstellationMark({ className }: { className?: string }) {
  return (
    <svg
      width="21"
      height="20"
      viewBox="52 58 152 140"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {/* `data-part` is how the cold open (ADR-0055) choreographs the mark:
          lines draw, stars come up behind them, Vega lands last. Nothing else
          reads these — at 21px the mark is a static logo. */}
      <g data-part="lines" fill="none" stroke="var(--border-strong)" strokeWidth="5">
        <path d="M108 118 L168 102 L188 162 L128 178 Z" />
        <path d="M78 84 L108 118" />
      </g>
      {/* `--star` is the sky's star colour and the only token that means "a
          charted point of light". The mark previously asked for `--subtle`,
          which no theme defines — an invalid var on a presentation attribute
          computes to black, so these four sat invisible on the night field. */}
      <g data-part="stars" fill="var(--star)">
        <circle cx="108" cy="118" r="7" />
        <circle cx="168" cy="102" r="6" />
        <circle cx="188" cy="162" r="6" />
        <circle cx="128" cy="178" r="6" />
      </g>
      <circle data-part="vega" cx="78" cy="84" r="19" fill="var(--accent)" />
    </svg>
  );
}
