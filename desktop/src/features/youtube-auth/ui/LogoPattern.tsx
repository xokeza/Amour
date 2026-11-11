import logo from "@/assets/logo.svg";

export default function LogoPattern() {
  return (
    <img
      src={logo}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="theme-logo pointer-events-none absolute -bottom-[70px] -right-[90px] h-[309px] w-[504px] object-contain opacity-[0.05] blur-[8px] select-none"
    />
  );
}
