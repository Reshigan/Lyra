/// <reference types="vite/client" />
/// <reference types="@react-router/dev/routes" />

/** Emitted by the React Router vite plugin at build time. Its namespace is a
 *  ServerBuild; only the members this app touches are named here. */
declare module "virtual:react-router/server-build" {
  import type { ServerBuild } from "react-router";
  export const routes: ServerBuild["routes"];
  export const assets: ServerBuild["assets"];
  export const entry: ServerBuild["entry"];
}
