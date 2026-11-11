interface GraphicsApp {
  commandLine: {
    hasSwitch(name: string): boolean;
    getSwitchValue?(name: string): string;
    appendSwitch(name: string, value?: string): void;
  };
  disableHardwareAcceleration(): void;
}

export function configureGraphics(
  app: GraphicsApp,
  platform: string,
  env: Record<string, string | undefined>,
  argv: string[] = [],
) {
  if (env.AMOUR_DISABLE_GPU === "1" || app.commandLine.hasSwitch("disable-gpu"))
    app.disableHardwareAcceleration();
  // Let Chromium honour its driver blocklist. Forced zero-copy/rasterization can produce blank windows.
  if (platform === "linux") {
    // A Wayland session must use its compositor, not an arbitrary DISPLAY server.
    // An explicit command-line choice remains authoritative.
    if (
      env.WAYLAND_DISPLAY &&
      !argv.some(
        (arg) =>
          arg === "--ozone-platform" || arg.startsWith("--ozone-platform="),
      )
    )
      app.commandLine.appendSwitch("ozone-platform", "wayland");
    const disabled =
      app.commandLine
        .getSwitchValue?.("disable-features")
        ?.split(",")
        .filter(Boolean) ?? [];
    app.commandLine.appendSwitch(
      "disable-features",
      [...new Set([...disabled, "Vulkan"])].join(","),
    );
  }
}

export function mainWindowSurface(platform: string) {
  return platform === "linux"
    ? { transparent: false, backgroundColor: "#18181b" }
    : { transparent: true, backgroundColor: "#00000000" };
}
