import logo from "@/assets/logo.svg";

export function AboutBackdrop() {
  return (
    <img
      src={logo}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="theme-logo pointer-events-none absolute inset-0 size-full object-cover opacity-[0.02] select-none"
    />
  );
}
