import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/shared/api/api";
import {
  buildTasteProfile,
  createPersonalWave,
  PersonalWave,
} from "./personalWave";
import type { Track } from "@/shared/types";
import type { PlaybackHistoryItem } from "@/shared/contracts/history";

const track = (id: string, artists = id): Track => ({
  id,
  title: id,
  artists,
  coverUrl: "",
  durationMs: 180000,
  playCount: 0,
});
const history = (
  id: string,
  skipped: boolean,
  completionRate: number,
): PlaybackHistoryItem => ({
  id,
  playbackSessionId: id,
  listeningSessionId: id,
  track: { id, title: id, artists: [], durationMs: 180000 },
  playedDurationMs: 180000 * completionRate,
  completionRate,
  completed: completionRate > 0.9,
  skipped,
  loopCount: 0,
  hasSeekBackward: false,
  listenedAt: new Date().toISOString(),
});
afterEach(() => vi.restoreAllMocks());

describe("personal wave", () => {
  it("uses completed listens, excludes early skips and allows explicit likes to override old skips", () => {
    const profile = buildTasteProfile(
      [track("liked")],
      [
        history("liked", true, 0.1),
        history("skip", true, 0.1),
        history("finished", false, 1),
      ],
      [track("skip")],
    );
    expect(profile.seeds.map((seed) => seed.track.id)).toEqual([
      "liked",
      "finished",
    ]);
    expect(profile.blocked.has("skip")).toBe(true);
  });

  it("deduplicates versions and queued songs and diversifies neighbouring artists", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.spyOn(api, "getRadio").mockResolvedValue({
      items: [
        track("a", "A"),
        track("b", "A"),
        track("c", "B"),
        track("a", "A"),
        { ...track("other-id", "A"), title: "a" },
      ],
    } as never);
    const wave = new PersonalWave(buildTasteProfile([track("seed")], [], []));
    const next = await wave.next([track("seed")]);
    expect(next.map((item) => item.id)).toEqual(["a", "c", "b"]);
  });

  it("changes the next batch after an early skip", async () => {
    vi.spyOn(api, "getRadio").mockResolvedValue({
      items: [track("skip"), track("new")],
    } as never);
    const wave = new PersonalWave(buildTasteProfile([track("seed")], [], []));
    wave.feedback(track("skip"), true, 1000);
    expect((await wave.next([track("seed")])).map((item) => item.id)).toEqual([
      "new",
    ]);
  });

  it("keeps working if some taste sources fail", async () => {
    vi.spyOn(api, "listLikedTracks").mockRejectedValue(new Error("offline"));
    vi.spyOn(api, "getHistory").mockRejectedValue(new Error("offline"));
    vi.spyOn(api, "getDailyMixes").mockResolvedValue({
      items: [
        {
          tracks: [
            { id: "mix", title: "mix", artists: [], durationMs: 180000 },
          ],
        },
      ],
    } as never);
    vi.spyOn(api, "getRadio").mockRejectedValue(new Error("offline"));
    const wave = await createPersonalWave();
    expect((await wave.next([])).map((item) => item.id)).toEqual(["mix"]);
  });

  it("starts a new listener from popular tracks", async () => {
    vi.spyOn(api, "listLikedTracks").mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    vi.spyOn(api, "getHistory").mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    vi.spyOn(api, "getDailyMixes").mockResolvedValue({
      items: [],
      generatedAt: "",
    });
    vi.spyOn(api, "getPopularTracks").mockResolvedValue({
      items: [
        {
          track: {
            id: "popular",
            title: "popular",
            artists: [],
            durationMs: 180000,
          },
        },
      ],
    } as never);
    vi.spyOn(api, "getRadio").mockResolvedValue({ items: [] });
    expect((await (await createPersonalWave()).next([]))[0].id).toBe("popular");
  });
});

it("keeps unused candidates and keeps finding new tracks beyond the first radio page", async () => {
  const radio = vi.spyOn(api, "getRadio").mockImplementation(async (seed) => ({
    items: Array.from({ length: 12 }, (_, i) => ({
      id: `${seed}_${i}`,
      title: `${seed}_${i}`,
      artists: [{ id: "artist", name: "Artist" }],
      durationMs: 180000,
    })),
  }));
  const wave = new PersonalWave(buildTasteProfile([track("seed")], [], []));
  const queue: Track[] = [];
  for (let i = 0; i < 8; i++) {
    const batch = await wave.next(queue, 10);
    expect(batch.length).toBe(10);
    expect(
      batch.some((item) => queue.some((previous) => previous.id === item.id)),
    ).toBe(false);
    queue.push(...batch);
  }
  expect(new Set(queue.map((item) => item.id)).size).toBe(80);
  expect(radio.mock.calls.some(([seed]) => seed !== "seed")).toBe(true);
});

it("reports unavailable catalog separately from a batch containing only duplicates", async () => {
  const radio = vi.spyOn(api, "getRadio").mockRejectedValue({ status: 0 });
  const wave = new PersonalWave(buildTasteProfile([track("seed")], [], []));
  await expect(wave.next([track("seed")])).rejects.toMatchObject({
    name: "WaveCatalogError",
    reason: "unavailable",
  });
  radio.mockResolvedValue({ items: [] });
  await expect(wave.next([track("seed")])).resolves.toEqual([]);
});

it("reports rate limits without blaming the internet connection", async () => {
  vi.spyOn(api, "getRadio").mockRejectedValue({ status: 429 });
  const wave = new PersonalWave(buildTasteProfile([track("seed")], [], []));
  await expect(wave.next([track("seed")])).rejects.toMatchObject({
    reason: "rate-limited",
  });
});

it("retries a discovery seed after a failed request instead of permanently exhausting it", async () => {
  const radio = vi
    .spyOn(api, "getRadio")
    .mockResolvedValue({ items: [track("discovery")] } as never);
  const wave = new PersonalWave(buildTasteProfile([track("seed")], [], []));
  expect((await wave.next([track("seed")], 1))[0].id).toBe("discovery");
  radio.mockRejectedValue({ status: 0 });
  await expect(
    wave.next([track("seed"), track("discovery")], 1),
  ).rejects.toMatchObject({ reason: "unavailable" });
  radio.mockImplementation(
    async (seed) =>
      ({ items: seed === "discovery" ? [track("fresh")] : [] }) as never,
  );
  expect((await wave.next([track("seed"), track("discovery")], 1))[0].id).toBe(
    "fresh",
  );
});
