import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "@/languages";
import { sidebarNavItems } from "@/features/navigation/data/navigation";
import { useModalStore } from "@/features/library/store/modalStore";
import { cn } from "@/shared/lib";
export function MobileNavigation({
  searchOpen,
  onSearchToggle,
}: {
  searchOpen: boolean;
  onSearchToggle: () => void;
}) {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const order = ["home", "search", "wave", "library", "settings"];
  return (
    <nav
      data-mobile-navigation
      aria-label={t("common.navigation")}
      className="relative z-[60] grid h-[68px] shrink-0 grid-cols-5 items-center bg-bg-primary px-2"
    >
      {order.map((id) => {
        const item = sidebarNavItems.find((item) => item.id === id)!;
        const Icon = item.Icon;
        const label = t(`common.sidebar.${id}`);
        const active =
          id === "search"
            ? searchOpen
            : !searchOpen &&
              (item.href === pathname ||
                (id === "library" && pathname.startsWith("/library")));
        const content = (
          <>
            <Icon size={id === "wave" ? 30 : 24} />
            <span
              className={id === "wave" ? "sr-only" : "text-[11px] leading-none"}
            >
              {label}
            </span>
          </>
        );
        const style = cn(
          "flex min-h-12 flex-col items-center justify-center gap-1.5 rounded-item border-none bg-transparent transition-colors active:bg-fill focus-visible:outline-2 focus-visible:outline-text-primary",
          active ? "text-text-primary" : "text-text-secondary",
          id === "wave" && "mx-auto h-12 w-12 rounded-full bg-fill",
        );
        return item.href ? (
          <Link
            key={id}
            to={item.href}
            className={style}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            onClick={() => useModalStore.getState().closeSearch()}
          >
            {content}
          </Link>
        ) : (
          <button
            key={id}
            type="button"
            className={style}
            aria-label={label}
            aria-pressed={id === "search" ? searchOpen : undefined}
            onClick={
              id === "search"
                ? onSearchToggle
                : () => useModalStore.getState().openSettings()
            }
          >
            {content}
          </button>
        );
      })}
    </nav>
  );
}
