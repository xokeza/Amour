import { useEffect } from "react";

interface IconLayout {
  canvas: number;
  inset: number;
  radius: number;
  shadow: boolean;
}

const FULL_BLEED: IconLayout = {
  canvas: 512,
  inset: 0,
  radius: 112,
  shadow: false,
};

const MAC_DOCK: IconLayout = {
  canvas: 1024,
  inset: 100,
  radius: 185,
  shadow: true,
};

function loadIcon(): Promise<HTMLImageElement> {
  const img = new Image();
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load app icon"));
    img.src = `${import.meta.env.BASE_URL}icon.png`;
  });
}

async function renderIconDataUrl(layout: IconLayout): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = layout.canvas;
  canvas.height = layout.canvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const img = await loadIcon();
  const size = layout.canvas - layout.inset * 2;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(layout.inset, layout.inset, size, size, layout.radius);
  } else {
    ctx.rect(layout.inset, layout.inset, size, size);
  }
  if (layout.shadow) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;
    // The shadow follows the dock silhouette, not the square source image.
    ctx.fillStyle = "#5C4A85";
    ctx.fill();
    ctx.shadowColor = "transparent";
  }
  ctx.clip();
  ctx.drawImage(img, layout.inset, layout.inset, size, size);
  return canvas.toDataURL("image/png");
}

export function useAppIconSync() {
  useEffect(() => {
    let active = true;
    const layout =
      window.amourElectron?.platform === "darwin" ? MAC_DOCK : FULL_BLEED;

    void renderIconDataUrl(layout)
      .then((dataUrl) => {
        if (!active || !dataUrl) return;

        if (window.amourElectron?.setAppIcon) {
          void window.amourElectron.setAppIcon(dataUrl, { isDefault: true });
        }

        let favicon =
          document.querySelector<HTMLLinkElement>("link[rel~='icon']");
        if (!favicon) {
          favicon = document.createElement("link");
          favicon.rel = "icon";
          document.head.appendChild(favicon);
        }
        favicon.href = dataUrl;
      })
      .catch((error: unknown) => {
        // Keep the packaged icon and static favicon if rendering is unavailable.
        if (active) console.warn("Failed to sync app icon:", error);
      });

    return () => {
      active = false;
    };
    // Branding is theme-independent; theme changes must not reset a track icon.
  }, []);
}
