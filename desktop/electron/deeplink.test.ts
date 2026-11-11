import { describe, expect, it } from "vitest";
import { findDeeplinkArg, parseDeeplink } from "./deeplink";

describe("parseDeeplink", () => {
  it("accepts real share targets", () => {
    expect(parseDeeplink("amour://artist?id=UCGtGpOIGHfRu1KYL9pi-mNQ")).toEqual(
      {
        type: "artist",
        id: "UCGtGpOIGHfRu1KYL9pi-mNQ",
      },
    );
    expect(parseDeeplink("amour://album?id=MPREb_xCxkOKReFZv")).toEqual({
      type: "album",
      id: "MPREb_xCxkOKReFZv",
    });
    expect(
      parseDeeplink("amour://playlist?id=VLPLD8jNKEyHYB2DHh5vXSI4USLFo29vzUYl"),
    ).toEqual({ type: "playlist", id: "VLPLD8jNKEyHYB2DHh5vXSI4USLFo29vzUYl" });
    expect(parseDeeplink("amour://track?id=RGdkabupfPI")).toEqual({
      type: "track",
      id: "RGdkabupfPI",
    });
  });

  it("accepts artist names used when a track has no channel id", () => {
    expect(parseDeeplink("amour://artist?id=LATIN%20MAFIA")).toEqual({
      type: "artist",
      id: "LATIN MAFIA",
    });
  });

  it("rejects smuggled urls", () => {
    expect(parseDeeplink("https://evil.com")).toBeNull();
    expect(parseDeeplink("javascript:alert(1)")).toBeNull();
    expect(parseDeeplink("amour://artist?id=LATIN%20MAFIA%0A")).toBeNull();
    expect(
      parseDeeplink("amour://artist?id=UCaaaaaaaaaaaaaaaaaaaaaa&x=1&y=2"),
    ).toEqual({
      type: "artist",
      id: "UCaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(
      parseDeeplink(
        "amour://artist?id=UCaaaaaaaaaaaaaaaaaaaaaa&id=UCbbbbbbbbbbbbbbbbbbbbbb",
      ),
    ).toBeNull();
    expect(parseDeeplink("amour://artist")).toBeNull();
    expect(parseDeeplink("amour://evil?id=RGdkabupfPI")).toBeNull();
    expect(parseDeeplink("amour://track?id=RGdkabupfPIextra")).toBeNull();
    expect(
      parseDeeplink("amour://artist?id=ABaaaaaaaaaaaaaaaaaaaaaa"),
    ).toBeNull();
    expect(parseDeeplink("amour://artist?id=UCaaa/../../../../etc")).toBeNull();
    expect(parseDeeplink("not a url")).toBeNull();
  });

  it("finds the deeplink arg anywhere in argv", () => {
    expect(
      findDeeplinkArg(["/usr/bin/amour", "amour://track?id=RGdkabupfPI"]),
    ).toBe("amour://track?id=RGdkabupfPI");
    expect(findDeeplinkArg(["/usr/bin/amour", "--no-sandbox"])).toBeUndefined();
  });
});

it("accepts old share links while using amour as the primary scheme", () => {
  expect(parseDeeplink("liner://track?id=RGdkabupfPI")).toEqual({
    type: "track",
    id: "RGdkabupfPI",
  });
  expect(findDeeplinkArg(["amour", "liner://track?id=RGdkabupfPI"])).toBe(
    "liner://track?id=RGdkabupfPI",
  );
});
