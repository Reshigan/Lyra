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
      <g fill="none" stroke="var(--border-strong)" strokeWidth="5">
        <path d="M108 118 L168 102 L188 162 L128 178 Z" />
        <path d="M78 84 L108 118" />
      </g>
      <g fill="var(--subtle)">
        <circle cx="108" cy="118" r="7" />
        <circle cx="168" cy="102" r="6" />
        <circle cx="188" cy="162" r="6" />
        <circle cx="128" cy="178" r="6" />
      </g>
      <circle cx="78" cy="84" r="19" fill="var(--accent)" />
    </svg>
  );
}
