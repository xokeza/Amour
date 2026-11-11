import { api } from "@/shared/api/api";
import { toClientTrack } from "@/shared/api/track";
import type { PlaybackHistoryItem } from "@/shared/contracts/history";
import type { Track } from "@/shared/types";
import { isLocalTrackId } from "@/shared/media/local";

export type WaveCatalogFailure = "unavailable" | "rate-limited";
export class WaveCatalogError extends Error {
  constructor(public readonly reason: WaveCatalogFailure) {
    super(reason);
    this.name = "WaveCatalogError";
  }
}

export const MY_WAVE_CONTEXT = "radio:my-wave";
const identity = (track: Track) =>
  `${track.title.trim().toLowerCase()}|${track.artists.trim().toLowerCase()}`;
const artist = (track: Track) => track.artists.trim().toLowerCase();

export function buildTasteProfile(
  likes: Track[],
  history: PlaybackHistoryItem[],
  mixes: Track[],
  now = Date.now(),
) {
  const seeds = new Map<string, { track: Track; weight: number }>();
  const blocked = new Set<string>();
  const add = (track: Track, weight: number) => {
    if (!track.id || isLocalTrackId(track.id)) return;
    const previous = seeds.get(track.id);
    seeds.set(track.id, { track, weight: (previous?.weight ?? 0) + weight });
  };
  for (const track of likes) add(track, 5);
  for (const entry of history) {
    if (isLocalTrackId(entry.track.id)) continue;
    if (entry.skipped && entry.completionRate < 0.25) {
      blocked.add(entry.track.id);
      continue;
    }
    if (entry.completionRate < 0.5 && !entry.completed) continue;
    const age = Math.max(0, now - Date.parse(entry.listenedAt));
    const decay = Number.isFinite(age) ? Math.exp(-age / (14 * 86400000)) : 0.5;
    add(toClientTrack(entry.track), (entry.completed ? 3 : 1.5) * decay);
  }
  for (const track of mixes) add(track, 1);
  // An explicit like overrides an old early skip.
  for (const track of likes) blocked.delete(track.id);
  return {
    seeds: [...seeds.values()]
      .filter(({ track }) => !blocked.has(track.id))
      .sort((a, b) => b.weight - a.weight),
    blocked,
  };
}

export class PersonalWave {
  private cursor = 0;
  private pool: Track[] = [];
  private frontier: Track[] = [];
  private explored = new Set<string>();
  private blocked: Set<string>;
  private seeds: { track: Track; weight: number }[];
  private affinity = new Map<string, number>();

  constructor(profile: ReturnType<typeof buildTasteProfile>) {
    this.blocked = profile.blocked;
    // Weighted sampling without replacement keeps familiar seeds strong without starting identically every time.
    this.seeds = profile.seeds
      .map((seed) => ({
        ...seed,
        priority:
          -Math.log(Math.max(Number.EPSILON, Math.random())) / seed.weight,
      }))
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 40);
    for (const seed of profile.seeds) {
      const key = artist(seed.track);
      this.affinity.set(key, (this.affinity.get(key) ?? 0) + seed.weight);
    }
  }

  feedback(track: Track, skipped: boolean, positionMs: number) {
    if (skipped && positionMs < Math.min(30000, track.durationMs * 0.25)) {
      this.blocked.add(track.id);
      this.affinity.set(
        artist(track),
        (this.affinity.get(artist(track)) ?? 0) - 3,
      );
    } else if (!skipped || positionMs >= track.durationMs * 0.5) {
      this.affinity.set(
        artist(track),
        (this.affinity.get(artist(track)) ?? 0) + 1,
      );
      if (!this.seeds.some((seed) => seed.track.id === track.id)) {
        this.seeds.push({ track, weight: 1 });
        if (this.seeds.length > 60) this.seeds.shift();
      }
    }
  }

  async next(queue: Track[], limit = 30): Promise<Track[]> {
    const tasteSeeds = this.seeds.filter(
      ({ track }) => !this.blocked.has(track.id),
    );
    const candidates = [...this.pool];
    const queued = new Set(queue.map((track) => track.id));
    let successfulRequests = 0;
    let failures = 0;
    let failureReason: WaveCatalogFailure = "unavailable";
    // Keep unused candidates and explore new radio seeds instead of repeatedly requesting
    // the same finite first page. Each batch stays anchored to the user's taste.
    for (let round = 0; round < 3; round++) {
      if (
        new Set(
          candidates
            .filter(
              (track) => !queued.has(track.id) && !this.blocked.has(track.id),
            )
            .map(identity),
        ).size >= limit
      )
        break;
      const selected: Track[] = [];
      for (let i = 0; i < Math.min(2, tasteSeeds.length); i++) {
        selected.push(tasteSeeds[this.cursor++ % tasteSeeds.length].track);
      }
      const discovery = this.frontier.find(
        (track) => !this.explored.has(track.id) && !this.blocked.has(track.id),
      );
      if (discovery) selected.push(discovery);
      else if (tasteSeeds.length > 2)
        selected.push(tasteSeeds[this.cursor++ % tasteSeeds.length].track);
      const unique = selected.filter(
        (track, index) =>
          selected.findIndex((item) => item.id === track.id) === index,
      );
      if (!unique.length) break;
      const responses = await Promise.allSettled(
        unique.map((seed) =>
          api.getRadio(seed.id, {
            k: 40,
            history: queue.slice(-100).map((track) => track.id),
          }),
        ),
      );
      responses.forEach((response, index) => {
        if (response.status === "fulfilled") {
          successfulRequests += 1;
          this.explored.add(unique[index].id);
        } else {
          failures += 1;
          if ((response.reason as { status?: number })?.status === 429)
            failureReason = "rate-limited";
        }
      });
      const found = responses.flatMap((response) =>
        response.status === "fulfilled"
          ? response.value.items.map(toClientTrack)
          : [],
      );
      candidates.push(...found);
      for (const track of found) {
        if (
          !this.explored.has(track.id) &&
          !isLocalTrackId(track.id) &&
          !this.blocked.has(track.id) &&
          !this.frontier.some((item) => item.id === track.id)
        )
          this.frontier.push(track);
      }
      this.frontier = this.frontier
        .filter((track) => !this.explored.has(track.id))
        .slice(-200);
      const fresh = new Set(
        candidates
          .filter(
            (track) => !queued.has(track.id) && !this.blocked.has(track.id),
          )
          .map(identity),
      );
      const untriedTaste = tasteSeeds.some(
        ({ track }) => !this.explored.has(track.id),
      );
      if (
        fresh.size >= limit ||
        responses.every((response) => response.status === "rejected") ||
        (!this.frontier.length && !untriedTaste)
      )
        break;
    }
    candidates.push(...tasteSeeds.map((seed) => seed.track));
    const ids = new Set(queue.map((track) => track.id));
    const songs = new Set(queue.map(identity));
    const available = candidates
      .filter((track) => {
        if (
          !track.id ||
          isLocalTrackId(track.id) ||
          this.blocked.has(track.id) ||
          ids.has(track.id) ||
          songs.has(identity(track))
        )
          return false;
        ids.add(track.id);
        songs.add(identity(track));
        return true;
      })
      .map((track) => ({
        track,
        score:
          Math.sign(this.affinity.get(artist(track)) ?? 0) *
            Math.log1p(Math.abs(this.affinity.get(artist(track)) ?? 0)) +
          Math.random() * 2,
      }));
    const result: Track[] = [];
    const counts = new Map<string, number>();
    let lastArtist = queue.length ? artist(queue[queue.length - 1]) : "";
    while (available.length && result.length < limit) {
      available.sort(
        (a, b) =>
          b.score -
          (counts.get(artist(b.track)) ?? 0) * 3 -
          (artist(b.track) === lastArtist ? 5 : 0) -
          (a.score -
            (counts.get(artist(a.track)) ?? 0) * 3 -
            (artist(a.track) === lastArtist ? 5 : 0)),
      );
      const { track } = available.shift()!;
      result.push(track);
      lastArtist = artist(track);
      counts.set(lastArtist, (counts.get(lastArtist) ?? 0) + 1);
    }
    this.pool = available.map(({ track }) => track).slice(0, 200);
    if (!result.length && failures > 0 && successfulRequests === 0)
      throw new WaveCatalogError(failureReason);
    return result;
  }
}

export async function createPersonalWave(
  fallback?: Track | null,
): Promise<PersonalWave> {
  const [likes, history, mixes] = await Promise.allSettled([
    api.listLikedTracks(100),
    api.getHistory(undefined, 100),
    api.getDailyMixes(),
  ]);
  const profile = buildTasteProfile(
    likes.status === "fulfilled"
      ? likes.value.items.map((item) => toClientTrack(item.track))
      : [],
    history.status === "fulfilled" ? history.value.items : [],
    mixes.status === "fulfilled"
      ? mixes.value.items.flatMap((mix) => mix.tracks.map(toClientTrack))
      : [],
  );
  if (
    !profile.seeds.length &&
    fallback &&
    !isLocalTrackId(fallback.id) &&
    !profile.blocked.has(fallback.id)
  )
    profile.seeds.push({ track: fallback, weight: 1 });
  if (!profile.seeds.length) {
    const popular = await api.getPopularTracks("7d", 20);
    for (const item of popular.items) {
      if (!isLocalTrackId(item.track.id) && !profile.blocked.has(item.track.id))
        profile.seeds.push({ track: toClientTrack(item.track), weight: 1 });
    }
  }
  return new PersonalWave(profile);
}
