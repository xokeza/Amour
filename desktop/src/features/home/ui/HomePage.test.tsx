import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
const state = vi.hoisted(() => ({
  failed: false,
  search: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/languages", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/shared/lib", () => ({ usePageBackdrop: vi.fn() }));
vi.mock("@/features/library/store/modalStore", () => ({
  useModalStore: {
    getState: () => ({
      openSearch: state.search,
      openCreatePlaylist: state.create,
    }),
  },
}));
vi.mock("../hooks/useListeningNow", () => ({
  useListeningNow: () => ({
    tracks: [],
    isLoading: false,
    isError: state.failed,
  }),
}));
vi.mock("../hooks/usePopularTracks", () => ({
  usePopularTracksAllTime: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("../hooks/useRecentlyPlayed", () => ({
  useRecentlyPlayed: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("../hooks/useDailyMixes", () => ({
  useDailyMixes: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("../hooks/useExploreCollections", () => ({
  usePopularAlbums: () => ({ items: [], isLoading: false, isError: false }),
  useMostSaved: () => ({ items: [], isLoading: false, isError: false }),
}));
vi.mock("../hooks/useHomeBackdrop", () => ({ useHomeBackdrop: () => ({}) }));
vi.mock("./PopularTracksSection", () => ({ default: () => null }));
vi.mock("./DailyMixesSection", () => ({ default: () => null }));
vi.mock("./ListeningNowSection", () => ({ default: () => null }));
vi.mock("./HomePageSkeleton", () => ({
  default: () => null,
  MixesSectionSkeleton: () => null,
}));
import HomePage from "./HomePage";
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, host: HTMLDivElement;
function render() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<HomePage />));
  return host;
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  state.failed = false;
  vi.clearAllMocks();
});
describe("new account home", () => {
  it("shows an actionable empty library instead of a network failure after successful empty responses", () => {
    const view = render();
    expect(view.textContent).toContain("home.empty_title");
    expect(view.textContent).not.toContain("home.load_failed");
    act(() => view.querySelectorAll("button")[0].click());
    expect(state.search).toHaveBeenCalledOnce();
    act(() => view.querySelectorAll("button")[1].click());
    expect(state.create).toHaveBeenCalledOnce();
  });
  it("retains the failure/retry state when the empty feed is actually caused by a failed request", () => {
    state.failed = true;
    const view = render();
    expect(view.textContent).toContain("home.load_failed");
    expect(view.textContent).not.toContain("home.empty_title");
    expect(view.querySelectorAll("button")).toHaveLength(1);
  });
});
