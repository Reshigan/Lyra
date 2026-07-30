import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";
import { WORKSPACE_PATHS } from "./routing";

// One placeholder file backs every workspace: the screens are a later phase, and
// seven identical files would be seven files to delete. Each route still gets
// its own id and its own URL, so replacing one with a real screen is a one-line
// change here.
export default [
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  layout("routes/workspace.tsx", [
    index("routes/home.tsx"),
    ...WORKSPACE_PATHS.map((path) =>
      route(path.slice(1), "routes/placeholder.tsx", { id: `workspace${path}` })
    )
  ])
] satisfies RouteConfig;
