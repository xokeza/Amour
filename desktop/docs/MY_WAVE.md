# My wave

`/wave` is opened by the Yandex Music SVG directly below Home in the existing sidebar.
The logo is bundled locally from the user-supplied logo-teka URL; this feature does not
connect to Yandex Music or use its proprietary recommendation model.

## Current desktop implementation

`src/features/wave/lib/personalWave.ts` builds a per-session taste profile from up to
100 likes, 100 recent listening events, and existing server daily mixes. Likes carry
weight 5, completed listens weight 3 with a 14-day exponential decay, and mix seeds
weight 1. Early skips below 25% are excluded; an explicit like overrides historical
negative feedback. Local tracks never become network recommendation seeds.

Weighted sampling chooses up to 40 initial seeds. Each batch asks the existing catalog
radio for taste seeds and newly discovered seeds, deduplicates IDs and identical title/artist pairs against
the queue, and ranks by artist affinity with randomized exploration. Consecutive artists
and repeated artists in the same batch receive penalties. Early manual skips update
the session profile immediately; completion strengthens artist affinity and adds fresh
seeds. These are heuristic weights, not a trained model or measured quality scores.

The player owns `radio:my-wave`, playback, and automatic refill. Repeat-all does not
wrap radio to its beginning. Late responses are checked against the station generation.
A new listener starts from popular tracks. Failed taste sources are tolerated independently;
unplayed profile tracks provide a fallback when related-track requests fail. If all
sources are unavailable, the page exposes an error and a retry button. Internet access
and the availability/coverage of the catalog still bound continuation.

The session profile is held in memory and cleared by stop/sign-out. Existing account
history remains the source between launches. No extra Python service, database, or model
is bundled in the installers. Refreshing the wave reloads likes/history/mixes.

## Repository review (2026-11-09)

| Project                                            | Purpose                                                                                             | Fit for Amour                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [Gorse](https://github.com/gorse-io/gorse)         | Recommendation service with feedback APIs, training workers, multiple candidate sources and ranking | Best candidate for a separate production recommendation backend with shared catalog and user feedback          |
| [implicit](https://github.com/benfred/implicit)    | Python collaborative filtering for implicit feedback, including ALS/BPR                             | Useful offline baseline once a user–track interaction dataset is available                                     |
| [LightFM](https://github.com/lyst/lightfm)         | Hybrid factorization using interactions and item/user features                                      | Useful with reliable genre/artist/content metadata and sparse interactions                                     |
| [RecBole](https://github.com/rucaibox/recbole)     | PyTorch recommendation research and evaluation framework                                            | Suitable for comparing trained models and temporal evaluation, rather than shipping inside Electron            |
| [Faiss](https://github.com/facebookresearch/faiss) | Similarity search and clustering for dense vectors                                                  | Candidate retrieval after audio/text embeddings exist; does not itself learn musical taste                     |
| [Milvus](https://github.com/milvus-io/milvus)      | Scalable vector database with metadata filtering                                                    | Infrastructure for a large embedding catalog; requires embedding generation and a recommendation/ranking layer |

A future backend should start with Gorse or an implicit baseline, evaluate temporal
holdouts (Recall/NDCG), and check artist diversity, discovery, repeat rate and early-skip
rate in real listening sessions. Add Faiss/Milvus only when embedding-based retrieval
is needed. The supplied desktop checkout contains no recommendation backend or training
dataset, so claiming trained collaborative recommendations here would be misleading.

## Verification and packaging

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run src/features/wave src/features/player/engine/radioPlayback.test.ts
pnpm build
pnpm exec electron-builder --linux AppImage --x64 --publish never
pnpm exec electron-builder --win nsis --x64 --publish never
```

Cross-building Windows on Linux uses Wine and omits the optional Windows native snap
preview addon (the existing fallback is used). Windows installation and OS integrations
need a smoke test on Windows. Files are written into `release/`; builds are not published.

## Packaging fix in 0.2.13

Amour no longer loads the upstream renderer-update feed by default: this ensures the
shipped wave feature cannot disappear under a different OTA interface. The sidebar
shows a compact Wave label below the SVG and keeps the destination visible offline.
Linux graphics compatibility and the real AppImage smoke test are documented in
[PROJECT_MAP.md](PROJECT_MAP.md).

## Animated wave and continuous discovery

The navigation glyph uses `currentColor`, matching Home. `WaveArtwork.tsx` animates
a depth-offset deck of real queue covers, with a flowing abstract waveform before playback.
`WaveTrackFocus.tsx` slides/fades cover and title changes, with preview buttons for
upcoming songs. Previous/Next controls act through the existing player engine.
Ambient motion pauses on hover/focus, hidden windows and reduced-motion preferences.

Recommendation batches target 30 tracks. Unused candidates remain in a bounded
200-track reservoir. A bounded frontier of newly discovered songs supplies fresh
radio seeds, anchored by two taste seeds per round; up to three rounds try to fill a
batch. Early skips exclude tracks from both selection and future seed exploration.
The engine refills with ten tracks left. Scrolling near the end or pressing Discover
more requests another batch through the same single-flight engine path. The screen
virtualizes the upcoming queue rather than capping it to 16 visible songs. If the
catalog is unavailable, the station remains selected with a retryable paused state.
Continuation still depends on the online catalog returning playable tracks.

The isolated test covers eight batches / 80 distinct tracks, artist diversity, late
responses, early refill and transient exhaustion. AppImage smoke additionally checks
animated cover artwork with a 40-track fixture, selecting a track, reduced motion and offline
visibility. The `*-active-test.png` screenshot uses labeled test data.

## Availability and scroll isolation

The wave now reports catalog unavailability, rate limiting, and duplicate-only
batches separately. Failed discovery requests do not consume their seeds. Anonymous
Music catalog requests can retry Google's reachable production API host after a
network failure. The virtual list owns its scroll updates in `WaveQueue.tsx`; the
artwork and track focus receive stable props and are memoized. Offscreen artwork
pauses its continuous animation, preserving it when it returns to view.

## Focused listening layout (0.2.16)

The navigation entry is icon-only, retaining its accessible name and tooltip. The
screen uses a panoramic cover reel: the current sleeve leads, the next sleeves recede
in depth and remain clickable. On selection, sleeves move forward through the reel;
the current title and transport sit below. Cover/title transitions use opacity and transforms;
the small playback indicator pauses offscreen, in hidden windows, when paused, and
with reduced motion. The virtual queue remains isolated from the header. Decorative
journey/continuation captions are removed; loading and catalog errors remain explicit.

`AMOUR_LAYOUT_PROBE=1 node scripts/smoke-appimage.mjs` additionally checks horizontal
overflow at 760px and 1440px and saves screenshots of the populated layout. All tracks
in these screenshots belong to the isolated test fixture, not the user's library.
