import { memo } from "react";
import logo from "@/assets/logo.svg";
import CoverImage from "@/features/covers/ui/CoverImage";
import { useTranslation } from "@/languages";
import { useCoverFluidColors } from "../hooks/useCoverFluidColors";

export interface DailyMixCoverProps {
  coverUrl?: string;
  mixNumber: string | number;
  imageLoaded: boolean;
  onLoad?: () => void;
}

const mixLabelStyle: React.CSSProperties = {
  fontFamily: "var(--font-roboto-flex), sans-serif",
  fontWeight: 649,
  fontVariationSettings:
    "'wght' 649, 'XOPQ' 100, 'YTAS' 739, 'YTDE' -224, 'YTLC' 494, 'YTUC' 667, 'wdth' 151, 'opsz' 144",
  lineHeight: 0.8,
  letterSpacing: "-0.04em",
};

const mixNumberStyle: React.CSSProperties = {
  fontFamily: "var(--font-roboto-flex), sans-serif",
  fontWeight: 523,
  fontVariationSettings:
    "'wght' 523, 'GRAD' 77, 'XOPQ' 148, 'XTRA' 548, 'YOPQ' 110, 'YTAS' 741, 'YTDE' -305, 'YTFI' 640, 'YTLC' 525, 'YTUC' 748, 'wdth' 121, 'opsz' 144",
  lineHeight: 0.8,
  letterSpacing: "-0.02em",
};

function DailyMixCover({
  coverUrl,
  mixNumber,
  imageLoaded,
  onLoad,
}: DailyMixCoverProps) {
  const { color1, logoColor } = useCoverFluidColors(coverUrl);
  const { locale } = useTranslation();
  const labelLines = locale === "ru" ? ["МИ", "КС"] : ["MIX"];

  return (
    <div
      className={`relative isolate aspect-square w-full overflow-hidden rounded-control select-none ${
        coverUrl && imageLoaded ? "" : "bg-border-alpha-14"
      }`}
    >
      {coverUrl && (
        <CoverImage
          src={coverUrl}
          alt="Mix Cover"
          fill
          sizes="175px"
          className={`object-cover transition-all duration-300 group-hover:brightness-[1.15] ${
            imageLoaded ? "opacity-100" : "opacity-0"
          }`}
          onLoad={onLoad}
        />
      )}

      <div
        className="absolute inset-0 pointer-events-none transition-opacity duration-500"
        style={{
          background: `linear-gradient(45deg, ${color1} 0%, rgba(0, 0, 0, 0.2) 100%)`,
        }}
      />

      <span
        aria-hidden="true"
        className="absolute top-[12px] left-[12px] w-[22px] h-[17px] pointer-events-none transition-colors duration-500"
        style={{
          backgroundColor: logoColor,
          maskImage: `url(${logo})`,
          maskSize: "contain",
          maskPosition: "center",
          maskRepeat: "no-repeat",
        }}
      />

      <div
        className="absolute bottom-[8px] left-[10px] flex flex-col text-white text-[44px] pointer-events-none select-none"
        style={mixLabelStyle}
      >
        {labelLines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>

      <span
        className="absolute bottom-[8px] right-[10px] text-white text-[46px] pointer-events-none select-none"
        style={mixNumberStyle}
      >
        {mixNumber}
      </span>
    </div>
  );
}

export default memo(DailyMixCover);
