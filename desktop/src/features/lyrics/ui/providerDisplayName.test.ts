import { describe, expect, it } from "vitest";
import { providerDisplayName } from "./providerDisplayName";

describe("providerDisplayName", () => {
  it.each(["Liner", "liner", "LINER", " Liner ", "Amour", "amour", "brand"])(
    "brands the visible label for %s without changing its identifier",
    (provider: string) => {
      const option = { provider };
      expect(providerDisplayName(option.provider)).toBe("Amour!");
      expect(option.provider).toBe(provider);
    },
  );

  it.each(["kugou", "LRCLIB", "Amour Radio", "Amour!"])(
    "preserves the unrelated provider %s",
    (provider: string) => {
      expect(providerDisplayName(provider)).toBe(provider);
    },
  );
});
