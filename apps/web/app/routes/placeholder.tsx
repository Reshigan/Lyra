import { useLocation } from "react-router";
import { DEFAULT_LOCALE, translator } from "../i18n";
import { labelKeyFor } from "../routing";
import { useShellData } from "./workspace";

// Every module workspace, until its screens land. It renders the title and
// nothing else on purpose: an invented empty state would be a design decision
// made in the wrong phase.

export default function Placeholder() {
  const shell = useShellData();
  const t = translator(shell?.locale ?? DEFAULT_LOCALE);
  const { pathname } = useLocation();

  return <h1 className="font-display text-28">{t(labelKeyFor(pathname))}</h1>;
}
