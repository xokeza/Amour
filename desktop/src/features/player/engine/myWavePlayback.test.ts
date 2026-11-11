import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playerEngine, usePlayerStore } from "./playerEngine";
import * as waveModule from "@/features/wave/lib/personalWave";
import type { Track } from "@/shared/types";
const track = (id: string): Track => ({
  id,
  title: id,
  artists: id,
  durationMs: 180000,
  coverUrl: "",
  playCount: 0,
});

beforeEach(() => {
  vi.useFakeTimers();
  usePlayerStore.setState({
    status: "idle",
    queue: [],
    currentIndex: -1,
    currentTrack: null,
    positionMs: 0,
    durationMs: 0,
    repeat: "off",
    shuffle: false,
    playbackContext: null,
    autoplaySimilar: false,
  });
});
afterEach(async () => {
  await playerEngine.stopAndClear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mockWave() {
  const wave = new waveModule.PersonalWave(
    waveModule.buildTasteProfile([], [], []),
  );
  vi.spyOn(waveModule, "createPersonalWave").mockResolvedValue(wave);
  return wave;
}

describe("My wave playback", () => {
  it("starts and refills the personal station with autoplay disabled", async () => {
    const wave = mockWave();
    const next = vi
      .spyOn(wave, "next")
      .mockResolvedValueOnce([track("a"), track("b")])
      .mockResolvedValueOnce([track("c"), track("d")]);
    await playerEngine.startMyWave();
    expect(usePlayerStore.getState().playbackContext).toBe(
      waveModule.MY_WAVE_CONTEXT,
    );
    await playerEngine.skipNext();
    await vi.advanceTimersByTimeAsync(500);
    expect(next).toHaveBeenCalledTimes(2);
    expect(usePlayerStore.getState().queue.map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("does not start a delayed wave after another track was selected", async () => {
    const wave = mockWave();
    let finish!: (tracks: Track[]) => void;
    vi.spyOn(wave, "next").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const start = playerEngine.startMyWave();
    await Promise.resolve();
    await playerEngine.playTrack(
      track("chosen"),
      [track("chosen")],
      "playlist:chosen",
    );
    finish([track("late")]);
    await start;
    expect(usePlayerStore.getState().currentTrack?.id).toBe("chosen");
  });

  it("discards a refill after the user starts a new wave with the same context", async () => {
    const wave = mockWave();
    let finish!: (tracks: Track[]) => void;
    vi.spyOn(wave, "next")
      .mockResolvedValueOnce([track("a"), track("b")])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce([track("new"), track("new-next")]);
    await playerEngine.startMyWave();
    await playerEngine.skipNext();
    await vi.advanceTimersByTimeAsync(500);
    await playerEngine.startMyWave();
    finish([track("stale")]);
    await Promise.resolve();
    await Promise.resolve();
    expect(usePlayerStore.getState().queue.map((item) => item.id)).toEqual([
      "new",
      "new-next",
    ]);
  });
  it("buffers ahead and preserves the station when the catalog temporarily runs dry", async () => {
    const wave = mockWave();
    const next = vi
      .spyOn(wave, "next")
      .mockResolvedValueOnce(
        Array.from({ length: 12 }, (_, i) => track(`track-${i}`)),
      )
      .mockResolvedValue([]);
    await playerEngine.startMyWave();
    await playerEngine.skipNext(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(next).toHaveBeenCalledTimes(2);
    usePlayerStore.setState({
      currentIndex: 11,
      currentTrack: track("track-11"),
    });
    await playerEngine.skipNext(true);
    expect(usePlayerStore.getState().currentTrack?.id).toBe("track-11");
    expect(usePlayerStore.getState().playbackContext).toBe(
      waveModule.MY_WAVE_CONTEXT,
    );
    expect(usePlayerStore.getState().status).toBe("paused");
  });
});

it("distinguishes service failures from an exhausted duplicate-only batch", async () => {
  const wave = mockWave();
  const next = vi
    .spyOn(wave, "next")
    .mockResolvedValueOnce([track("a"), track("b")])
    .mockResolvedValueOnce([]);
  await playerEngine.startMyWave();
  expect(await playerEngine.extendMyWave()).toBe("empty");
  next.mockRejectedValueOnce(new waveModule.WaveCatalogError("rate-limited"));
  expect(await playerEngine.extendMyWave()).toBe("rate-limited");
  expect(usePlayerStore.getState().currentTrack?.id).toBe("a");
  expect(usePlayerStore.getState().queue.map((item) => item.id)).toEqual([
    "a",
    "b",
  ]);
});
