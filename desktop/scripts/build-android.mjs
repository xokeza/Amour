import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const sdk =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  path.join(homedir(), "Android/Sdk");
if (!existsSync(sdk))
  throw new Error("Set ANDROID_HOME to your Android SDK directory");
const { version } = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const parts = version.split(".").map(Number),
  versionCode = parts[0] * 1000000 + parts[1] * 1000 + parts[2];
const debug = process.argv.includes("--debug");
const env = { ...process.env, ANDROID_HOME: sdk };
const candidates = path.join(homedir(), ".sdkman/candidates/java");
let javaMajor = 0;
try {
  javaMajor = Number(
    readFileSync(path.join(env.JAVA_HOME || "", "release"), "utf8").match(
      /JAVA_VERSION="(\d+)/,
    )?.[1],
  );
} catch {}
if (
  (!env.JAVA_HOME || javaMajor < 21 || javaMajor > 24) &&
  existsSync(candidates)
) {
  const jdk = readdirSync(candidates)
    .filter((name) => name.startsWith("21."))
    .sort()
    .at(-1);
  if (jdk) env.JAVA_HOME = path.join(candidates, jdk);
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    env,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (!debug) {
  const signing = path.join(homedir(), ".local/share/amour/android-signing");
  mkdirSync(signing, { recursive: true, mode: 0o700 });
  const credentials = path.join(signing, "credentials.json");
  if (!existsSync(credentials))
    writeFileSync(
      credentials,
      JSON.stringify({ password: randomBytes(36).toString("base64url") }),
      { mode: 0o600, flag: "wx" },
    );
  env.AMOUR_ANDROID_STORE_PASSWORD = JSON.parse(
    readFileSync(credentials, "utf8"),
  ).password;
  env.AMOUR_ANDROID_KEYSTORE = path.join(signing, "amour-release.p12");
  if (!existsSync(env.AMOUR_ANDROID_KEYSTORE))
    run(env.JAVA_HOME ? path.join(env.JAVA_HOME, "bin/keytool") : "keytool", [
      "-genkeypair",
      "-keystore",
      env.AMOUR_ANDROID_KEYSTORE,
      "-storetype",
      "PKCS12",
      "-alias",
      "amour",
      "-keyalg",
      "RSA",
      "-keysize",
      "4096",
      "-validity",
      "10000",
      "-dname",
      "CN=Amour, O=Xokeza",
      "-storepass:env",
      "AMOUR_ANDROID_STORE_PASSWORD",
      "-keypass:env",
      "AMOUR_ANDROID_STORE_PASSWORD",
    ]);
  chmodSync(env.AMOUR_ANDROID_KEYSTORE, 0o600);
}
writeFileSync(path.join(root, "android/local.properties"), `sdk.dir=${sdk}\n`);
run(
  process.platform === "win32" ? "gradlew.bat" : "./gradlew",
  [
    debug ? "assembleDebug" : "assembleRelease",
    `-PamourVersion=${version}`,
    `-PamourVersionCode=${versionCode}`,
    "--no-daemon",
    "--max-workers=2",
  ],
  { cwd: path.join(root, "android") },
);
const target = debug ? "debug" : "release";
mkdirSync(path.join(root, "release"), { recursive: true });
const output = path.join(
  root,
  `release/Amour-${version}-android${debug ? "-debug" : ""}.apk`,
);
copyFileSync(
  path.join(root, `android/app/build/outputs/apk/${target}/app-${target}.apk`),
  output,
);
if (!debug && process.env.AMOUR_ANDROID_SMOKE !== "1") {
  const signing = path.join(homedir(), ".local/share/amour/android-signing");
  const lineage = path.join(signing, "signing-lineage.bin");
  const legacy = path.join(homedir(), ".android/debug.keystore");
  const apksigner = path.join(sdk, "build-tools/36.0.0/apksigner");
  if (process.env.AMOUR_ANDROID_ROTATE_DEBUG === "1" && !existsSync(lineage)) {
    if (!existsSync(legacy))
      throw new Error(
        "The original debug signing key is required to preserve installed app data",
      );
    run(apksigner, [
      "rotate",
      "--out",
      lineage,
      "--old-signer",
      "--ks",
      legacy,
      "--ks-key-alias",
      "androiddebugkey",
      "--ks-pass",
      "pass:android",
      "--new-signer",
      "--ks",
      env.AMOUR_ANDROID_KEYSTORE,
      "--ks-key-alias",
      "amour",
      "--ks-pass",
      "env:AMOUR_ANDROID_STORE_PASSWORD",
    ]);
  }
  if (existsSync(lineage)) {
    run(apksigner, [
      "sign",
      "--ks",
      legacy,
      "--ks-key-alias",
      "androiddebugkey",
      "--ks-pass",
      "pass:android",
      "--next-signer",
      "--ks",
      env.AMOUR_ANDROID_KEYSTORE,
      "--ks-key-alias",
      "amour",
      "--ks-pass",
      "env:AMOUR_ANDROID_STORE_PASSWORD",
      "--lineage",
      lineage,
      "--rotation-min-sdk-version",
      "28",
      "--out",
      output + ".rotated",
      output,
    ]);
    renameSync(output + ".rotated", output);
  }
  run(apksigner, ["verify", output]);
}
console.log(`APK: ${output}`);
