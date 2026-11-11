import { memo, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { Track } from "@/shared/types";

function WaveTrackFocusComponent({
  current,
  children,
}: {
  current: Track;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="relative min-w-0 flex-1 min-h-[88px]">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: reduced ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduced ? 0 : -8 }}
            transition={{
              duration: reduced ? 0.08 : 0.16,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <h2 className="line-clamp-2 break-words text-[clamp(26px,3.4vw,42px)] font-semibold leading-[1.12] tracking-tight text-text-primary">
              {current.title}
            </h2>
            <p className="mt-3 truncate text-heading text-text-secondary">
              {current.artists}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
      {children}
    </div>
  );
}
export const WaveTrackFocus = memo(WaveTrackFocusComponent);
