import type { AmourElectronApi } from "../electron/preload";

declare global {
  interface Window {
    amourElectron?: AmourElectronApi;
  }
}

export {};
