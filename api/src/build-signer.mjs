// Reuses the bundled desktop signer without changing its ABI or extracting secrets.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
await build({
  entryPoints: [
    fileURLToPath(new URL("../../desktop/electron/crypto.ts", import.meta.url)),
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: fileURLToPath(new URL("./legacy-signer.mjs", import.meta.url)),
  logLevel: "warning",
});
