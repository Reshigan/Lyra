/**
 * Barrel for the 22-kind section contract, the three Screen-kind renderers
 * (`SurfaceScreen` via `renderSection`, `ListScreen` via `ListScreenView`,
 * `MobileScreen` via `MobileScreenView`) and `Hero`. `renderSection` is the
 * single dispatch point apps/web/app/routes/surface.tsx uses to turn a
 * `Section` into JSX — a switch over `SectionKind`, exhaustively checked so
 * a 23rd kind added to ./types.ts fails typecheck here rather than silently
 * rendering nothing.
 */
import * as React from "react";
import { KpiSection } from "./kpi-section.js";
import { StatSection } from "./stat-section.js";
import { PairSection } from "./pair-section.js";
import { StepsSection } from "./steps-section.js";
import { TimelineSection } from "./timeline-section.js";
import { RowsSection } from "./rows-section.js";
import { BarsSection } from "./bars-section.js";
import { BandsSection } from "./bands-section.js";
import { SparkSection } from "./spark-section.js";
import { RadarSection } from "./radar-section.js";
import { FlowSection } from "./flow-section.js";
import { BoardSection } from "./board-section.js";
import { KvSection } from "./kv-section.js";
import { ChatSection } from "./chat-section.js";
import { GhostSection } from "./ghost-section.js";
import { CalloutSection } from "./callout-section.js";
import { NotesSection } from "./notes-section.js";
import { FormSection } from "./form-section.js";
import { QuotesSection } from "./quotes-section.js";
import { FrameSection } from "./frame-section.js";
import { TextSection } from "./text-section.js";
import { EmptySection } from "./empty-section.js";
import type { Section, ScreenModule } from "./types.js";

export * from "./types.js";
export { Hero, type HeroProps } from "./hero.js";
export { ListScreenView } from "./list-screen.js";
export { MobileScreenView } from "./mobile-screen.js";
export { ScreenState, type ScreenStateKind, type ScreenStateProps } from "./screen-state.js";

export {
  KpiSection,
  StatSection,
  PairSection,
  StepsSection,
  TimelineSection,
  RowsSection,
  BarsSection,
  BandsSection,
  SparkSection,
  RadarSection,
  FlowSection,
  BoardSection,
  KvSection,
  ChatSection,
  GhostSection,
  CalloutSection,
  NotesSection,
  FormSection,
  QuotesSection,
  FrameSection,
  TextSection,
  EmptySection
};

/** Renders one `Section` for the given screen module — the dispatcher
 * `apps/web/app/routes/surface.tsx` maps `screen.sections` through. */
export function renderSection(section: Section, mod: ScreenModule): React.ReactNode {
  switch (section.kind) {
    case "kpi":
      return <KpiSection section={section} mod={mod} />;
    case "stat":
      return <StatSection section={section} mod={mod} />;
    case "pair":
      return <PairSection section={section} mod={mod} />;
    case "steps":
      return <StepsSection section={section} mod={mod} />;
    case "timeline":
      return <TimelineSection section={section} mod={mod} />;
    case "rows":
      return <RowsSection section={section} mod={mod} />;
    case "bars":
      return <BarsSection section={section} mod={mod} />;
    case "bands":
      return <BandsSection section={section} mod={mod} />;
    case "spark":
      return <SparkSection section={section} mod={mod} />;
    case "radar":
      return <RadarSection section={section} mod={mod} />;
    case "flow":
      return <FlowSection section={section} mod={mod} />;
    case "board":
      return <BoardSection section={section} mod={mod} />;
    case "kv":
      return <KvSection section={section} mod={mod} />;
    case "chat":
      return <ChatSection section={section} mod={mod} />;
    case "ghost":
      return <GhostSection section={section} mod={mod} />;
    case "callout":
      return <CalloutSection section={section} mod={mod} />;
    case "notes":
      return <NotesSection section={section} mod={mod} />;
    case "form":
      return <FormSection section={section} mod={mod} />;
    case "quotes":
      return <QuotesSection section={section} mod={mod} />;
    case "frame":
      return <FrameSection section={section} mod={mod} />;
    case "text":
      return <TextSection section={section} mod={mod} />;
    case "empty":
      return <EmptySection section={section} mod={mod} />;
    default: {
      const exhaustive: never = section;
      return exhaustive;
    }
  }
}
