import { Redirect } from "expo-router";
import { Loading } from "../../src/ui";
import { useSession } from "../../src/session";
import { tabsFor } from "../../src/personas";

export default function Tab2() {
  const session = useSession();
  const chrome = { theme: session.theme, t: session.t, dir: session.dir };
  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;
  const tab = tabsFor(session.persona.workspace, session.persona.variant)[1];
  if (!tab) return <Redirect href="/(tabs)/more" />;
  return <Redirect href={tab.route ?? `/m/${tab.screen}`} />;
}
