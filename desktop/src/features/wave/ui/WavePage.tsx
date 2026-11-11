import { SkipNext, SkipPrevious } from "@solar-icons/react";
import { WaveTrackFocus } from "./WaveTrackFocus";
import { useCallback, useMemo, useRef, useState } from "react";
import { PlayFill, PauseFill, Refresh2Line } from "@mingcute/react";
import { WaveQueue, type WaveMoreIssue } from "./WaveQueue";
import { useOfflineModeStore } from "@/features/connectivity/store/offlineModeStore";
import { goOnline } from "@/features/connectivity/engine/offlineController";
import { useTranslation } from "@/languages";
import { playerEngine } from "@/features/player/engine/playerEngine";
import { usePlayerStore } from "@/features/player/store/playerStore";
import Button from "@/shared/ui/Button";
import { usePageBackdrop } from "@/shared/lib";
import type { Track } from "@/shared/types";
import { MY_WAVE_CONTEXT } from "../lib/personalWave";
import { WaveArtwork } from "./WaveArtwork";

export default function WavePage() {
  const { t } = useTranslation();
  const offline = useOfflineModeStore((state) => state.offline);
  const checking = useOfflineModeStore((state) => state.checking);
  const context = usePlayerStore((state) => state.playbackContext);
  const current = usePlayerStore((state) => state.currentTrack);
  const queue = usePlayerStore((state) => state.queue);
  const index = usePlayerStore((state) => state.currentIndex);
  const status = usePlayerStore((state) => state.status);
  const [loading, setLoading] = useState(false);
  const [extending, setExtending] = useState(false);
  const busy = useRef(false);
  const moreBusy = useRef(false);
  const cooldown = useRef(0);
  const [error, setError] = useState(false);
  const [moreError, setMoreError] = useState<WaveMoreIssue>(null);
  const page = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLElement>(null);
  const active = context === MY_WAVE_CONTEXT;
  const playing = active && (status === "playing" || status === "loading");
  const upcoming = useMemo(
    () => (active ? queue.slice(Math.max(0, index)) : []),
    [active, queue, index],
  );
  usePageBackdrop(active ? current?.coverUrl : undefined);
  const artworkTracks = useMemo(() => upcoming.slice(0, 4), [upcoming]);

  const start = async () => {
    if (busy.current || offline) return;
    busy.current = true;
    setLoading(true);
    setError(false);
    setMoreError(null);
    try {
      await playerEngine.startMyWave();
      page.current?.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };
  const loadMore = useCallback(async () => {
    if (moreBusy.current || offline || !active || Date.now() < cooldown.current)
      return;
    moreBusy.current = true;
    setExtending(true);
    setMoreError(null);
    try {
      const result = await playerEngine.extendMyWave();
      if (result !== "added" && result !== "stale") {
        setMoreError(result);
        cooldown.current = Date.now() + 10000;
      }
    } catch {
      setMoreError("unavailable");
      cooldown.current = Date.now() + 10000;
    } finally {
      moreBusy.current = false;
      setExtending(false);
    }
  }, [offline, active]);
  const retryMore = useCallback(() => {
    cooldown.current = 0;
    void loadMore();
  }, [loadMore]);
  const select = useCallback(
    (track: Track) => {
      const queueIndex = queue.findIndex((item) => item.id === track.id);
      if (track.id === current?.id) playerEngine.togglePlayPause();
      else if (queueIndex >= 0)
        void playerEngine.playTrack(
          track,
          queue,
          MY_WAVE_CONTEXT,
          track.coverUrl,
          queueIndex,
        );
    },
    [queue, current?.id],
  );
  const controls = (
    <div className="flex items-center gap-3">
      {active && (
        <Button
          variant="ghost"
          size="icon"
          disabled={offline || index <= 0}
          aria-label={t("wave.previous")}
          title={t("wave.previous")}
          onClick={() => void playerEngine.skipPrevious()}
        >
          <SkipPrevious size={24} />
        </Button>
      )}
      <Button
        disabled={loading || offline}
        size="icon"
        className="!h-14 !w-14 !rounded-full"
        aria-label={t(
          loading ? "wave.loading" : playing ? "wave.pause" : "wave.play",
        )}
        title={t(playing ? "wave.pause" : "wave.play")}
        onClick={() => (active ? playerEngine.togglePlayPause() : void start())}
      >
        {playing ? <PauseFill size={26} /> : <PlayFill size={26} />}
      </Button>
      {active && (
        <Button
          variant="ghost"
          size="icon"
          disabled={offline}
          aria-label={t("wave.next")}
          title={t("wave.next")}
          onClick={() => void playerEngine.skipNext()}
        >
          <SkipNext size={24} />
        </Button>
      )}
      {loading && (
        <span role="status" className="ml-2 text-body text-text-secondary">
          {t("wave.loading")}
        </span>
      )}
    </div>
  );
  return (
    <div
      ref={page}
      onScroll={(event) => {
        const el = event.currentTarget;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 360)
          void loadMore();
      }}
      className="relative h-full overflow-y-auto pt-(--page-inset-top) pb-(--page-inset-bottom)"
    >
      <section
        ref={hero}
        className="mx-auto max-w-[1160px] px-6 pt-4 pb-10 md:px-10"
      >
        <header className="mb-8 flex items-center justify-between gap-4">
          <h1 className="text-[24px] font-semibold tracking-tight text-text-primary">
            {t("wave.title")}
          </h1>
          {active && (
            <Button
              variant="ghost"
              size="sm"
              disabled={loading || offline}
              onClick={() => void start()}
              aria-label={t("wave.restart")}
              title={t("wave.restart")}
            >
              <Refresh2Line size={18} />
              <span className="hidden sm:inline">{t("wave.restart")}</span>
            </Button>
          )}
        </header>
        <div className="flex flex-col gap-5">
          <WaveArtwork
            tracks={artworkTracks}
            current={active ? current : null}
            playing={playing}
            disabled={offline}
            onSelect={select}
          />
          <div className="w-full min-w-0">
            {active && current ? (
              <WaveTrackFocus current={current}>{controls}</WaveTrackFocus>
            ) : (
              <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
                <p className="max-w-[480px] text-heading leading-relaxed text-text-secondary">
                  {t("wave.hint")}
                </p>
                {controls}
              </div>
            )}
            {offline && (
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <p role="status" className="text-label text-text-secondary">
                  {t("wave.offline")}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={checking}
                  onClick={() => void goOnline()}
                >
                  {t("offline.try_again")}
                </Button>
              </div>
            )}
            {error && (
              <p role="alert" className="mt-5 text-label text-text-secondary">
                {t("wave.error")}
              </p>
            )}
          </div>
        </div>
      </section>
      {active && upcoming.length > 0 && (
        <WaveQueue
          tracks={upcoming}
          scrollRef={page}
          heroRef={hero}
          onSelect={select}
          onMore={retryMore}
          offline={offline}
          extending={extending}
          issue={moreError}
        />
      )}
    </div>
  );
}
