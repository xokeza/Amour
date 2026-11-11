import { describe, expect, it, vi } from "vitest";
import { configureGraphics, mainWindowSurface } from "./graphics-policy";
const app = (switches: string[] = []) => ({
  commandLine: {
    hasSwitch: (name: string) => switches.includes(name),
    appendSwitch: vi.fn(),
  },
  disableHardwareAcceleration: vi.fn(),
});
describe("Linux graphics compatibility", () => {
  it("uses native Wayland even when DISPLAY is set and honours an explicit backend", () => {
    const target = app();
    configureGraphics(target, "linux", {
      WAYLAND_DISPLAY: "wayland-1",
      DISPLAY: ":0",
    });
    expect(target.commandLine.appendSwitch).toHaveBeenCalledWith(
      "ozone-platform",
      "wayland",
    );
    expect(target.commandLine.appendSwitch).toHaveBeenCalledWith(
      "disable-features",
      "Vulkan",
    );
    const explicit = app(["ozone-platform"]);
    configureGraphics(
      explicit,
      "linux",
      {
        WAYLAND_DISPLAY: "wayland-1",
        DISPLAY: ":0",
      },
      ["--ozone-platform=x11"],
    );
    expect(explicit.commandLine.appendSwitch).not.toHaveBeenCalledWith(
      "ozone-platform",
      "wayland",
    );
  });
  it("does not require XWayland when no X11 display is present", () => {
    const target = app();
    configureGraphics(target, "linux", { WAYLAND_DISPLAY: "wayland-1" });
    expect(target.commandLine.appendSwitch).not.toHaveBeenCalledWith(
      "ozone-platform",
      "x11",
    );
  });
  it("supports a software rendering fallback before app.ready", () => {
    const target = app();
    configureGraphics(target, "linux", { AMOUR_DISABLE_GPU: "1" });
    expect(target.disableHardwareAcceleration).toHaveBeenCalledOnce();
  });
  it("keeps Linux windows opaque and other platform surfaces unchanged", () => {
    expect(mainWindowSurface("linux").transparent).toBe(false);
    expect(mainWindowSurface("win32").transparent).toBe(true);
    const target = app();
    configureGraphics(target, "win32", {});
    expect(target.commandLine.appendSwitch).not.toHaveBeenCalled();
  });
});

it("keeps acceleration enabled by default on Wayland", () => {
  const target = app();
  configureGraphics(target, "linux", { WAYLAND_DISPLAY: "wayland-1" });
  expect(target.disableHardwareAcceleration).not.toHaveBeenCalled();
});
