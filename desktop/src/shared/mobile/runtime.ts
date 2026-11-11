import { App } from "@capacitor/app";
export async function initMobileRuntime() {
  await App.addListener("backButton", ({ canGoBack }) => {
    const playerClose = document.querySelector<HTMLButtonElement>(
      "[data-mobile-player-close]",
    );
    if (playerClose) {
      playerClose.click();
      return;
    }
    if (document.querySelector("[data-mobile-search]")) {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
        }),
      );
      return;
    }
    const dialog = document.querySelector(
      "[data-dialog-container], [data-dropdown-menu]",
    );
    if (dialog) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      return;
    }
    if (canGoBack && location.hash !== "#/") window.history.back();
    else void App.minimizeApp();
  });
  await App.addListener("appUrlOpen", ({ url }) => {
    try {
      const link = new URL(url);
      if (link.protocol === "amour:")
        location.hash = "/" + link.host + link.pathname + link.search;
    } catch {}
  });
}
