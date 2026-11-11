import fs from "node:fs";
import path from "node:path";

const TRANSIENT = new Set([
  "bundles",
  "active_bundle.json",
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "ShaderCache",
  "GrShaderCache",
  "Crashpad",
  "logs",
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket",
]);

/** Copy an old profile once; never modify the source or overwrite an Amour profile. */
export function migrateProfile(legacy: string, destination: string): void {
  if (fs.existsSync(destination) || !fs.existsSync(legacy)) return;
  const staging = `${destination}.migration-${process.pid}`;
  try {
    fs.cpSync(legacy, staging, {
      recursive: true,
      mode: fs.constants.COPYFILE_FICLONE,
      filter: (source) => {
        const relative = path.relative(legacy, source);
        if (relative && TRANSIENT.has(relative.split(path.sep)[0]))
          return false;
        const stat = fs.lstatSync(source);
        return !stat.isSymbolicLink() && !stat.isSocket();
      },
    });
    fs.renameSync(staging, destination);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    console.warn(
      "[Amour] Profile migration failed; the previous profile is intact:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
