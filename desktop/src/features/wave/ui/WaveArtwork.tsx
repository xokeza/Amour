import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Music2Fill } from "@mingcute/react";
import type { Track } from "@/shared/types";
import CoverImage from "@/features/covers/ui/CoverImage";
import { useTranslation } from "@/languages";
import {
  isWindowVisible,
  onWindowVisibilityChange,
} from "@/shared/utils/windowVisibility";
import { WaveIcon } from "./WaveIcon";
import "./wave.css";

function WaveArtworkComponent({
  tracks,
  current,
  playing,
  disabled,
  onSelect,
}: {
  tracks: Track[];
  current: Track | null;
  playing: boolean;
  disabled: boolean;
  onSelect: (track: Track) => void;
}) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const surface = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(
    () => isWindowVisible() && !document.hidden,
  );
  const [inView, setInView] = useState(true);
  useEffect(() => {
    if (!surface.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry.isIntersecting),
    );
    observer.observe(surface.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const sync = () => setVisible(isWindowVisible() && !document.hidden);
    const off = onWindowVisibilityChange(sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      off();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  const paused = Boolean(reduced || !visible || !inView || !playing);
  const covers = useMemo(
    () =>
      current
        ? [current, ...tracks.filter((track) => track.id !== current.id)].slice(
            0,
            4,
          )
        : [],
    [current, tracks],
  );
  const placements = [
    { x: "0cqw", y: 0, scale: 1, rotateY: 0, opacity: 1, zIndex: 4 },
    { x: "34cqw", y: 24, scale: 0.82, rotateY: -12, opacity: 0.88, zIndex: 3 },
    { x: "62cqw", y: 44, scale: 0.67, rotateY: -16, opacity: 0.64, zIndex: 2 },
    { x: "86cqw", y: 60, scale: 0.54, rotateY: -20, opacity: 0.4, zIndex: 1 },
  ];
  return (
    <div
      ref={surface}
      data-wave-artwork
      data-motion-paused={paused}
      className="[container-type:inline-size]"
    >
      <div className="wave-reel relative overflow-hidden [perspective:1000px]">
        <AnimatePresence initial={false}>
          {covers.map((track, index) => (
            <motion.button
              key={track.id}
              type="button"
              data-wave-track
              aria-label={t("wave.playTrack", { title: track.title })}
              title={`${track.title} — ${track.artists}`}
              disabled={disabled}
              onClick={() => onSelect(track)}
              initial={
                reduced
                  ? { opacity: 0 }
                  : { x: "100cqw", y: 70, scale: 0.5, rotateY: -25, opacity: 0 }
              }
              animate={placements[index]}
              exit={
                reduced
                  ? { opacity: 0 }
                  : { x: "-36cqw", y: 10, scale: 0.85, rotateY: 18, opacity: 0 }
              }
              transition={
                reduced
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 155, damping: 24, mass: 0.85 }
              }
              whileHover={
                reduced || index === 0
                  ? undefined
                  : { y: placements[index].y - 10, opacity: 1 }
              }
              style={{
                width: "var(--wave-cover)",
                transformOrigin: "top left",
              }}
              className="absolute left-0 top-2 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-text-primary disabled:cursor-default"
            >
              <span className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-item bg-bg-elevated">
                {track.coverUrl ? (
                  <CoverImage
                    src={track.coverUrl}
                    alt=""
                    fill
                    className="object-cover"
                  />
                ) : (
                  <Music2Fill size={80} className="text-text-tertiary" />
                )}
                {index === 0 && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute bottom-4 left-4 flex h-8 items-end gap-[3px] rounded-control bg-black/60 px-3 py-2 text-white"
                  >
                    {[0, 1, 2, 3, 4].map((bar) => (
                      <span
                        key={bar}
                        className="wave-level h-4 w-[3px] origin-bottom rounded-full bg-current"
                        style={{
                          animationDelay: `${bar * -0.19}s`,
                          animationPlayState: paused ? "paused" : "running",
                        }}
                      />
                    ))}
                  </span>
                )}
              </span>
              {index > 0 && index < 3 && (
                <span className="mt-3 block min-w-0">
                  <span className="block truncate text-heading font-medium text-text-primary">
                    {track.title}
                  </span>
                  <span className="mt-1 block truncate text-title text-text-secondary">
                    {track.artists}
                  </span>
                </span>
              )}
            </motion.button>
          ))}
        </AnimatePresence>
        {!current && (
          <div className="flex h-full items-center gap-12" aria-hidden="true">
            <div className="flex aspect-square w-[var(--wave-cover)] shrink-0 items-center justify-center rounded-item bg-fill-subtle text-text-primary">
              <WaveIcon size={112} />
            </div>
            <div className="flex h-28 flex-1 items-center gap-3 overflow-hidden text-text-primary opacity-15">
              {[24, 44, 68, 90, 74, 48, 32, 60, 82, 100, 66, 38, 20].map(
                (height, index) => (
                  <span
                    key={index}
                    className="w-2 shrink-0 rounded-full bg-current"
                    style={{ height: `${height}%` }}
                  />
                ),
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
export const WaveArtwork = memo(WaveArtworkComponent);
