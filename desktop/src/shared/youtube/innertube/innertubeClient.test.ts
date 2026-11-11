import { afterEach, describe, expect, it, vi } from "vitest";

const { getClientVisitorData, resetClientVisitorData } = vi.hoisted(() => ({
  getClientVisitorData: vi.fn(),
  resetClientVisitorData: vi.fn(),
}));

vi.mock("../session/visitorSession", () => ({
  getClientVisitorData,
  resetClientVisitorData,
}));

import { InnertubeError, postInnertube } from "./innertubeClient";

function reply(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("postInnertube", () => {
  it("retries once with a fresh visitor session when youtube rejects the first one", async () => {
    getClientVisitorData
      .mockResolvedValueOnce("stale")
      .mockResolvedValueOnce("fresh");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(403))
      .mockResolvedValueOnce(reply(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      postInnertube("browse", { browseId: "UClYV6hHlupm_S_ObS1W-DYw" }),
    ).resolves.toEqual({ ok: true });

    expect(resetClientVisitorData).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryHeaders = fetchMock.mock.calls[1][1].headers as Record<
      string,
      string
    >;
    expect(retryHeaders["x-goog-visitor-id"]).toBe("fresh");
  });

  it("gives up after the retry is rejected too", async () => {
    getClientVisitorData.mockResolvedValue("v");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(403)));

    await expect(
      postInnertube("browse", { browseId: "x" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      postInnertube("browse", { browseId: "x" }),
    ).rejects.toBeInstanceOf(InnertubeError);
  });

  it("does not retry other failures", async () => {
    getClientVisitorData.mockResolvedValue("v");
    const fetchMock = vi.fn().mockResolvedValue(reply(500));
    vi.stubGlobal("fetch", fetchMock);

    await expect(postInnertube("search", { query: "q" })).rejects.toMatchObject(
      { status: 500 },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resetClientVisitorData).not.toHaveBeenCalled();
  });
});

it("uses Google's YouTube API host for anonymous catalog calls when the Music host is unreachable", async () => {
  getClientVisitorData.mockResolvedValue("");
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("DNS failure"))
    .mockResolvedValueOnce(reply(200, { contents: {} }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    postInnertube("next", { videoId: "aaaaaaaaaaa" }),
  ).resolves.toEqual({ contents: {} });
  expect(String(fetchMock.mock.calls[0][0])).toContain("music.youtube.com");
  expect(String(fetchMock.mock.calls[1][0])).toBe(
    "https://youtubei.googleapis.com/youtubei/v1/next?prettyPrint=false",
  );
  expect(fetchMock.mock.calls[1][1].headers.authorization).toBeUndefined();
  expect(fetchMock.mock.calls[0][1].headers["x-origin"]).toBe(
    "https://music.youtube.com",
  );
  expect(fetchMock.mock.calls[1][1].headers["x-origin"]).toBeUndefined();
  expect(
    JSON.parse(fetchMock.mock.calls[1][1].body).context.client.clientName,
  ).toBe("WEB_REMIX");
});

it("does not forward account or player requests to the alternate host", async () => {
  getClientVisitorData.mockResolvedValue("");
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("DNS failure"));
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    postInnertube("account/accounts_list", {}),
  ).rejects.toMatchObject({ status: 0 });
  await expect(
    postInnertube("player", { videoId: "aaaaaaaaaaa" }),
  ).rejects.toMatchObject({ status: 0 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(
    fetchMock.mock.calls.every(([url]) =>
      String(url).startsWith("https://music.youtube.com/"),
    ),
  ).toBe(true);
});

it("does not start a fallback after cancellation", async () => {
  getClientVisitorData.mockResolvedValue("");
  const controller = new AbortController();
  const fetchMock = vi.fn().mockImplementation(() => {
    controller.abort();
    return Promise.reject(new DOMException("cancelled", "AbortError"));
  });
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    postInnertube("next", {}, { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchMock).toHaveBeenCalledOnce();
});
