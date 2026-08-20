import * as React from "react";
import { SectionShell } from "./shared.js";
import type { FrameSectionData, ScreenModule } from "./types.js";

export function FrameSection({ section, mod }: { section: FrameSectionData; mod: ScreenModule }) {
  return (
    <SectionShell title={section.title} mod={mod}>
      <div className="flex items-center gap-2.5 rounded-t-md border border-line2 bg-surface-3 px-4 py-2.5">
        <div className="flex gap-1.5" aria-hidden="true">
          <span className="size-2 rounded-full bg-line4" />
          <span className="size-2 rounded-full bg-line4" />
          <span className="size-2 rounded-full bg-line4" />
        </div>
        <div className="flex-1 truncate font-mono text-12 text-subtle">{section.url}</div>
        <div className="text-12 uppercase tracking-wide text-muted">{section.gate}</div>
      </div>
    </SectionShell>
  );
}
