import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateProfile } from "./profile-migration";
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "amour-profile-test-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
describe("Amour profile migration", () => {
  it("copies user libraries/settings but excludes upstream OTA and driver caches", () => {
    const old = path.join(root, "Liner"),
      next = path.join(root, "Amour");
    for (const folder of [
      "local-tracks",
      "auth",
      "Local Storage",
      "bundles",
      "GPUCache",
    ])
      fs.mkdirSync(path.join(old, folder), { recursive: true });
    fs.writeFileSync(
      path.join(old, "local-tracks", "library.json"),
      "test-library",
    );
    fs.writeFileSync(path.join(old, "Local Storage", "test"), "test-settings");
    fs.writeFileSync(path.join(old, "active_bundle.json"), "test-old-bundle");
    migrateProfile(old, next);
    expect(
      fs.readFileSync(path.join(next, "local-tracks", "library.json"), "utf8"),
    ).toBe("test-library");
    expect(fs.existsSync(path.join(next, "Local Storage", "test"))).toBe(true);
    expect(fs.existsSync(path.join(next, "active_bundle.json"))).toBe(false);
    expect(fs.existsSync(path.join(next, "bundles"))).toBe(false);
    expect(fs.existsSync(path.join(next, "GPUCache"))).toBe(false);
    expect(fs.existsSync(path.join(old, "local-tracks", "library.json"))).toBe(
      true,
    );
  });
  it("does not overwrite an existing Amour profile", () => {
    const old = path.join(root, "Liner"),
      next = path.join(root, "Amour");
    fs.mkdirSync(old);
    fs.mkdirSync(next);
    fs.writeFileSync(path.join(old, "settings"), "old");
    fs.writeFileSync(path.join(next, "settings"), "new");
    migrateProfile(old, next);
    expect(fs.readFileSync(path.join(next, "settings"), "utf8")).toBe("new");
  });
});
