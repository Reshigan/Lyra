import * as React from "react";
import { Badge } from "../primitives.js";
import { SectionShell } from "./shared.js";
import type { RowsSectionData, ScreenModule } from "./types.js";

export function RowsSection({ section, mod }: { section: RowsSectionData; mod: ScreenModule }) {
  const grid = section.grid ?? `repeat(${section.headers?.length ?? 1}, 1fr)`;
  return (
    <SectionShell title={section.title} mod={mod} flex={section.flex} min={section.min}>
      {section.sub ? <p className="-mt-1 text-12 text-subtle">{section.sub}</p> : null}
      <div role="table" aria-label={section.title || undefined} className="overflow-x-auto rounded-md bg-surface-2 shadow-elev">
        {section.headers?.length ? (
          <div
            role="row"
            className="grid min-w-max gap-x-4 border-b border-border px-4 py-3"
            style={{ gridTemplateColumns: grid }}
          >
            {section.headers.map((h, i) => (
              <div
                key={i}
                role="columnheader"
                className={`font-ui text-12 uppercase tracking-wide text-subtle ${h.align === "right" ? "text-end" : "text-start"}`}
              >
                {h.label}
              </div>
            ))}
          </div>
        ) : null}
        {section.items.map((row, ri) => (
          <div
            key={ri}
            role="row"
            className="grid min-w-max items-center gap-x-4 border-b border-border px-4 py-3 transition-colors duration-150 ease-out last:border-b-0 hover:bg-surface-3"
            style={{ gridTemplateColumns: grid }}
          >
            {row.cells.map((cell, ci) => (
              <div key={ci} role="cell" className={`min-w-0 ${cell.align === "right" ? "text-end" : "text-start"}`}>
                {cell.badge ? (
                  <Badge tone="neutral" size="sm" style={{ color: cell.hue, background: cell.bg, borderColor: cell.line }}>
                    {cell.v}
                  </Badge>
                ) : (
                  <span
                    className={`block truncate text-13 ${cell.plain ? "font-ui" : "font-mono tabular-nums"}`}
                    style={{ color: cell.hue || undefined, fontFamily: cell.font || undefined, fontSize: cell.size || undefined }}
                  >
                    {cell.v}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </SectionShell>
  );
}
