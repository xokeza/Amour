import { migrateBrandStorage } from "@/shared/storage/migrateBrandStorage";
import React from "react";
import { Capacitor } from "@capacitor/core";
import "./shared/mobile/mobile.css";
import ReactDOM from "react-dom/client";
import { initGlobalErrorHandlers } from "@/shared/utils/globalErrorHandlers";
import { hydrateScreenCache } from "@/shared/cache/screenCache";
import { applyStoredTheme } from "@/shared/utils/storedTheme";

initGlobalErrorHandlers();
try {
  migrateBrandStorage(localStorage);
} catch (error) {
  console.warn("[Amour] Settings migration unavailable", error);
}

const isOverlay = window.location.hash.startsWith("#/overlay");

if (!isOverlay) applyStoredTheme();

async function loadRoot(): Promise<React.ReactElement> {
  if (Capacitor.isNativePlatform()) {
    document.documentElement.dataset.platform = Capacitor.getPlatform();
    const { hydrateMobileSession } = await import("./shared/api/auth-session");
    await hydrateMobileSession();
    const { initMobileRuntime } = await import("./shared/mobile/runtime");
    await initMobileRuntime();
  }
  if (isOverlay) {
    const { default: OverlayApp } = await import("./app/OverlayApp");
    return <OverlayApp />;
  }
  const [
    { initMainWindowServices },
    { default: App },
    { default: RootErrorBoundary },
  ] = await Promise.all([
    import("./app/mainWindowServices"),
    import("./app/App"),
    import("@/shared/ui/RootErrorBoundary"),
    hydrateScreenCache(),
  ]);
  initMainWindowServices();
  return (
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  );
}

const rootElement = document.getElementById("root");

if (rootElement) {
  void loadRoot()
    .then((root) => {
      ReactDOM.createRoot(rootElement).render(
        <React.StrictMode>{root}</React.StrictMode>,
      );
    })
    .catch((error) => {
      console.error("[Amour] Renderer bootstrap failed", error);
      rootElement.replaceChildren();
      const message = document.createElement("p");
      message.textContent =
        "Amour! could not start. Не удалось запустить Amour!. Перезапусти приложение.";
      message.style.cssText =
        "padding:32px;color:#fafafa;background:#18181b;font:16px sans-serif";
      const retry = document.createElement("button");
      retry.textContent = "Retry / Повторить";
      retry.onclick = () => window.location.reload();
      rootElement.append(message, retry);
    });
}
