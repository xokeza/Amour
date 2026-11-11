import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "su.xokeza.amour",
  appName: "Amour!",
  webDir: "dist-android",
  server: { androidScheme: "https", hostname: "localhost" },
  android: {
    webContentsDebuggingEnabled: process.env.AMOUR_ANDROID_SMOKE === "1",
    allowMixedContent: false,
    backgroundColor: "#18181b",
    captureInput: false,
  },
  plugins: {
    CapacitorHttp: { enabled: true },
    SystemBars: { insetsHandling: "css" },
  },
};
export default config;
