import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { APP_NAME, configureAppIdentity } from "./app-identity";

describe("configureAppIdentity", () => {
  it.each([
    { isPackaged: true, profileName: "Amour" },
    { isPackaged: false, profileName: "@amour/client" },
  ])("uses the Amour profile (packaged: $isPackaged)", (options) => {
    const app = {
      isPackaged: options.isPackaged,
      getPath: vi.fn(() => "/app-data"),
      setPath: vi.fn(),
      setName: vi.fn(),
    };

    configureAppIdentity(app);

    const profile = path.join("/app-data", options.profileName);
    expect(app.getPath).toHaveBeenCalledWith("appData");
    expect(app.setPath).toHaveBeenCalledWith("userData", profile);
    expect(app.setPath).toHaveBeenCalledWith("sessionData", profile);
    expect(app.setName).toHaveBeenCalledWith(APP_NAME);
    expect(APP_NAME).toBe("Amour!");
    expect(app.setPath.mock.invocationCallOrder[1]).toBeLessThan(
      app.setName.mock.invocationCallOrder[0],
    );
  });
});
