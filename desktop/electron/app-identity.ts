import path from "node:path";
import type { App } from "electron";
import { migrateProfile } from "./profile-migration.js";

export const APP_NAME = "Amour!";

export function configureAppIdentity(
  app: Pick<App, "isPackaged" | "getPath" | "setPath" | "setName">,
) {
  const appData = app.getPath("appData");
  const userData = path.join(
    appData,
    app.isPackaged ? "Amour" : "@amour/client",
  );
  migrateProfile(
    path.join(appData, app.isPackaged ? "Liner" : "@liner/client"),
    userData,
  );
  app.setPath("userData", userData);
  app.setPath("sessionData", userData);
  app.setName(APP_NAME);
}
