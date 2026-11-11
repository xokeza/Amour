import { log } from "./logger";

export function initBundleStampLog(): () => void {
  if (typeof window === "undefined") return () => {};
  return (
    window.amourElectron?.onBundleStamp?.((line) =>
      log("gray", "bundle", line),
    ) ?? (() => {})
  );
}
