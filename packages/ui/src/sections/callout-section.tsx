import * as React from "react";
import { SectionShell } from "./shared.js";
import type { CalloutSectionData, ScreenModule } from "./types.js";

export function CalloutSection({ section, mod }: { section: CalloutSectionData; mod: ScreenModule }) {
  return (
    <SectionShell title={section.title} mod={mod} flex={section.flex} min={section.min}>
      <div
        className="rounded-md border p-4.5"
        style={{ borderColor: section.line, background: section.bg }}
      >
        {section.label ? (
          <div className="mb-2.5 text-12 uppercase tracking-wide" style={{ color: section.hue }}>
            {section.label}
          </div>
        ) : null}
        {section.body ? <p className="mb-3.5 max-w-[68ch] text-14 leading-relaxed text-muted">{section.body}</p> : null}
        <div className="flex flex-col gap-2.5">
          {section.items.map((item, i) => (
            <div
              key={i}
              className="flex items-baseline gap-3 rounded-sm px-1.5 py-0.5 transition-colors duration-150 ease-out hover:bg-surface-3"
            >
              <span className="w-29 shrink-0 font-mono text-12 tracking-wide" style={{ color: item.hue }}>
                {item.code}
              </span>
              <span className="text-13 leading-relaxed text-muted">{item.body}</span>
            </div>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}
