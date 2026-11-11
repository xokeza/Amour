import { beforeEach, describe, expect, it } from "vitest";
import { migrateBrandStorage } from "./migrateBrandStorage";
beforeEach(() => localStorage.clear());
describe("Amour settings migration", () => {
  it("moves old keys and local media URLs without altering unrelated settings", () => {
    localStorage.setItem(
      "liner_player_session_v2",
      '{"cover":"liner-local://cover/test"}',
    );
    localStorage.setItem("liner_auth_session", "test-session");
    localStorage.setItem("theme", "dark");
    migrateBrandStorage(localStorage);
    expect(localStorage.getItem("amour_player_session_v2")).toBe(
      '{"cover":"amour-local://cover/test"}',
    );
    expect(localStorage.getItem("amour_auth_session")).toBe("test-session");
    expect(localStorage.getItem("liner_auth_session")).toBeNull();
    expect(localStorage.getItem("theme")).toBe("dark");
    localStorage.removeItem("amour_auth_session");
    migrateBrandStorage(localStorage);
    expect(localStorage.getItem("amour_auth_session")).toBeNull();
  });
  it("preserves newer Amour values", () => {
    localStorage.setItem("liner_locale", "en");
    localStorage.setItem("amour_locale", "ru");
    migrateBrandStorage(localStorage);
    expect(localStorage.getItem("amour_locale")).toBe("ru");
    expect(localStorage.getItem("liner_locale")).toBeNull();
  });
});
