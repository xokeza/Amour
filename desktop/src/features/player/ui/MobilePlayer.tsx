import { memo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  DownLine,
  PlayFill,
  PauseFill,
  SkipPreviousFill,
  SkipForwardFill,
  ShuffleLine,
  RepeatLine,
  ListCheckLine,
  Music2Fill,
} from "@mingcute/react";
import { playerEngine } from "@/features/player/engine/playerEngine";
import { usePlayerStore } from "@/features/player/store/playerStore";
import { usePlayerState } from "@/features/player/hooks/usePlayerState";
import { TimelineSlider } from "@/features/player/ui/TimelineSlider";
import {
  isRadioContext,
  nextRepeatMode,
} from "@/features/player/engine/radioMode";
import CoverImage from "@/features/covers/ui/CoverImage";
import { useTranslation } from "@/languages";
import { cn } from "@/shared/lib";

export const MobileMiniPlayer = memo(function MobileMiniPlayer({
  onOpen,
}: {
  onOpen: () => void;
}) {
  const current = usePlayerStore((s) => s.currentTrack),
    status = usePlayerStore((s) => s.status);
  const { t } = useTranslation();
  if (!current) return null;
  const playing = status === "playing" || status === "loading";
  return (
    <div
      data-mobile-mini
      className="mx-2 flex h-[72px] shrink-0 items-center gap-2 rounded-item bg-bg-elevated px-3"
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 border-none bg-transparent text-left"
        aria-label={`${current.title} — ${current.artists}`}
      >
        <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-control bg-fill">
          {current.coverUrl ? (
            <CoverImage
              src={current.coverUrl}
              alt=""
              fill
              className="object-cover"
            />
          ) : (
            <Music2Fill size={24} />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-label font-medium text-text-primary">
            {current.title}
          </span>
          <span className="mt-1 block truncate text-caption text-text-secondary">
            {current.artists}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-btn-primary-bg text-btn-primary-text"
        onClick={() => playerEngine.togglePlayPause()}
        aria-label={t(playing ? "wave.pause" : "wave.play")}
      >
        {playing ? <PauseFill size={24} /> : <PlayFill size={24} />}
      </button>
      <button
        type="button"
        className="flex h-12 w-10 shrink-0 items-center justify-center text-text-primary"
        onClick={() => void playerEngine.skipNext()}
        aria-label={t("wave.next")}
      >
        <SkipForwardFill size={24} />
      </button>
    </div>
  );
});
const MobileTimeline = memo(function MobileTimeline() {
  const state = usePlayerState();
  return (
    <TimelineSlider
      positionMs={state.positionMs}
      durationMs={state.durationMs || state.currentTrack?.durationMs || 0}
      onSeek={(value) => playerEngine.seek(value)}
      showTime
      size="lg"
    />
  );
});

export function MobileNowPlaying({
  onClose,
  onQueue,
}: {
  onClose: () => void;
  onQueue: () => void;
}) {
  const { t } = useTranslation(),
    reduced = useReducedMotion();
  const current = usePlayerStore((s) => s.currentTrack),
    status = usePlayerStore((s) => s.status),
    shuffle = usePlayerStore((s) => s.shuffle),
    repeat = usePlayerStore((s) => s.repeat),
    context = usePlayerStore((s) => s.playbackContext);
  const playing = status === "playing" || status === "loading";
  if (!current) return null;
  return (
    <motion.section
      data-mobile-now-playing
      initial={{ y: reduced ? 0 : "100%" }}
      animate={{ y: 0 }}
      exit={{ y: reduced ? 0 : "100%" }}
      transition={{ duration: reduced ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 z-[80] flex flex-col overflow-y-auto bg-bg-primary px-6 pb-6"
    >
      <header className="flex h-14 shrink-0 items-center justify-between">
        <button
          data-mobile-player-close
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="-ml-2 flex h-12 w-12 items-center justify-center text-text-primary"
        >
          <DownLine size={26} />
        </button>
        <button
          type="button"
          onClick={onQueue}
          className="flex h-12 items-center gap-2 text-label text-text-secondary"
        >
          <ListCheckLine size={22} />
          {t("wave.upNext")}
        </button>
      </header>
      <div className="flex flex-1 flex-col justify-center gap-6 py-3">
        <div className="relative mx-auto flex aspect-square w-full max-w-[min(340px,40dvh)] items-center justify-center overflow-hidden rounded-item bg-fill">
          <AnimatePresence initial={false}>
            <motion.div
              key={current.id}
              initial={{ opacity: 0, x: reduced ? 0 : 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: reduced ? 0 : -20 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              {current.coverUrl ? (
                <CoverImage
                  src={current.coverUrl}
                  alt=""
                  fill
                  className="object-cover"
                />
              ) : (
                <Music2Fill size={80} className="text-text-tertiary" />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        <div>
          <h1 className="line-clamp-2 text-[26px] font-semibold leading-tight text-text-primary">
            {current.title}
          </h1>
          <p className="mt-2 truncate text-label text-text-secondary">
            {current.artists}
          </p>
        </div>
        <MobileTimeline />
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label={t("common.shuffle")}
            aria-pressed={shuffle}
            onClick={() => playerEngine.setShuffle(!shuffle)}
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-full",
              shuffle ? "bg-fill text-text-primary" : "text-text-secondary",
            )}
          >
            <ShuffleLine size={24} />
          </button>
          <button
            type="button"
            aria-label={t("wave.previous")}
            className="flex h-14 w-14 items-center justify-center text-text-primary"
            onClick={() => void playerEngine.skipPrevious()}
          >
            <SkipPreviousFill size={32} />
          </button>
          <button
            type="button"
            aria-label={t(playing ? "wave.pause" : "wave.play")}
            className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-btn-primary-bg text-btn-primary-text"
            onClick={() => playerEngine.togglePlayPause()}
          >
            {playing ? <PauseFill size={34} /> : <PlayFill size={34} />}
          </button>
          <button
            type="button"
            aria-label={t("wave.next")}
            className="flex h-14 w-14 items-center justify-center text-text-primary"
            onClick={() => void playerEngine.skipNext()}
          >
            <SkipForwardFill size={32} />
          </button>
          <button
            type="button"
            aria-label={t("player.repeat")}
            aria-pressed={repeat !== "off"}
            onClick={() =>
              playerEngine.setRepeat(
                nextRepeatMode(repeat, isRadioContext(context)),
              )
            }
            className={cn(
              "relative flex h-12 w-12 items-center justify-center rounded-full",
              repeat !== "off"
                ? "bg-fill text-text-primary"
                : "text-text-secondary",
            )}
          >
            <RepeatLine size={24} />
            {repeat === "one" && (
              <span className="absolute right-1 top-0 text-[10px]">1</span>
            )}
          </button>
        </div>
      </div>
    </motion.section>
  );
}
