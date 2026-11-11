import { describe, expect, it } from "vitest";
import { YOUTUBE_REQUEST_URLS, youtubeOriginFor } from "./request-origin";
describe("YouTube catalog fallback origin", () => {
  it("keeps the Music client origin for its production API host", () => {
    expect(YOUTUBE_REQUEST_URLS).toContain(
      "https://youtubei.googleapis.com/youtubei/v1/*",
    );
    expect(
      youtubeOriginFor("https://youtubei.googleapis.com/youtubei/v1/next"),
    ).toBe("https://music.youtube.com");
  });
});
