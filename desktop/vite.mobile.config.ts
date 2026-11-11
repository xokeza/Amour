import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import pkg from "./package.json" with { type: "json" };
import { contentSecurityPolicyPlugin } from "./vite.csp";
export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), tailwindcss(), contentSecurityPolicyPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "next/navigation": path.resolve(
        import.meta.dirname,
        "./src/lib/navigation.tsx",
      ),
      "next/link": path.resolve(
        import.meta.dirname,
        "./src/lib/navigation.tsx",
      ),
      "next/image": path.resolve(
        import.meta.dirname,
        "./src/components/ui/AppImage.tsx",
      ),
    },
  },
  build: {
    outDir: "dist-android",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2048,
  },
});
