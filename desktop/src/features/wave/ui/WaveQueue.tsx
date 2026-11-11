import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { RepeatLine } from "@mingcute/react";
import type { Track } from "@/shared/types";
import { useTranslation } from "@/languages";
import SongCard from "@/features/player/ui/SongCard";
import Button from "@/shared/ui/Button";

export type WaveMoreIssue = "empty" | "unavailable" | "rate-limited" | null;
const estimateRow = () => 64;
const QueueRow = memo(function QueueRow({
  track,
  onSelect,
}: {
  track: Track;
  onSelect: (track: Track) => void;
}) {
  const play = useCallback(() => onSelect(track), [onSelect, track]);
  return <SongCard {...track} onPlay={play} />;
});

export const WaveQueue = memo(function WaveQueue({
  tracks,
  scrollRef,
  heroRef,
  onSelect,
  onMore,
  offline,
  extending,
  issue,
}: {
  tracks: Track[];
  scrollRef: RefObject<HTMLDivElement | null>;
  heroRef: RefObject<HTMLElement | null>;
  onSelect: (track: Track) => void;
  onMore: () => void;
  offline: boolean;
  extending: boolean;
  issue: WaveMoreIssue;
}) {
  const { t } = useTranslation();
  const list = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      if (list.current && scrollRef.current)
        setMargin(
          list.current.getBoundingClientRect().top -
            scrollRef.current.getBoundingClientRect().top +
            scrollRef.current.scrollTop,
        );
    };
    measure();
    if (!heroRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(heroRef.current);
    return () => observer.disconnect();
  }, [scrollRef, heroRef]);
  const getScrollElement = useCallback(() => scrollRef.current, [scrollRef]);
  const getItemKey = useCallback(
    (offset: number) => tracks[offset]?.id ?? offset,
    [tracks],
  );
  const rows = useVirtualizer({
    count: tracks.length,
    getScrollElement,
    estimateSize: estimateRow,
    overscan: 6,
    scrollMargin: margin,
    getItemKey,
  });
  const message =
    issue === "unavailable"
      ? "wave.catalogUnavailable"
      : issue === "rate-limited"
        ? "wave.rateLimited"
        : issue === "empty"
          ? "wave.noNewTracks"
          : null;
  return (
    <section
      className="mx-auto max-w-[1160px] px-6 pb-8 md:px-10"
      data-wave-queue
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-heading font-semibold text-text-primary">
          {t("wave.upNext")}
        </h2>
      </div>
      <div
        ref={list}
        className="relative"
        style={{ height: rows.getTotalSize() }}
      >
        {rows.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className="absolute left-0 top-0 w-full"
            style={{
              height: row.size,
              transform: `translate3d(0, ${row.start - margin}px, 0)`,
              contain: "layout style",
            }}
          >
            <QueueRow track={tracks[row.index]} onSelect={onSelect} />
          </div>
        ))}
      </div>
      <div className="flex flex-col items-center gap-3 py-6">
        {message && (
          <p role="status" className="text-body text-text-secondary">
            {t(message)}
          </p>
        )}
        <Button
          variant="ghost"
          disabled={extending || offline}
          onClick={onMore}
        >
          <RepeatLine size={20} />
          {t(extending ? "wave.loadingMore" : "wave.more")}
        </Button>
      </div>
    </section>
  );
});
