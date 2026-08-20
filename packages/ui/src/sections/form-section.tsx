import * as React from "react";
import { SectionShell } from "./shared.js";
import type { FormSectionData, ScreenModule } from "./types.js";

export function FormSection({ section, mod }: { section: FormSectionData; mod: ScreenModule }) {
  return (
    <SectionShell title={section.title} mod={mod} flex={section.flex} min={section.min}>
      <div className="flex flex-wrap gap-4 rounded-md bg-surface-2 p-5 shadow-elev">
        {section.items.map((item, i) => (
          <div key={i} style={{ flex: `1 1 ${item.w}` }}>
            <div className="mb-1.5 flex items-baseline gap-2">
              <div className="text-12 text-subtle">{item.label}</div>
              {item.req ? (
                <div className="text-12" style={{ color: item.reqHue }}>
                  {item.req}
                </div>
              ) : null}
            </div>
            <div
              className="flex items-center justify-between gap-2.5 rounded-sm border px-3 py-2.5 transition-colors duration-150 ease-out hover:border-accent-line"
              style={{ borderColor: item.line, background: item.bg }}
            >
              <div
                className="truncate whitespace-nowrap text-14"
                style={{ fontFamily: item.font, color: item.vhue }}
              >
                {item.value}
              </div>
              <div className="shrink-0 text-12 text-subtle">{item.kind}</div>
            </div>
            {item.hint ? <div className="mt-1 text-12 leading-relaxed text-subtle">{item.hint}</div> : null}
          </div>
        ))}
      </div>
    </SectionShell>
  );
}
