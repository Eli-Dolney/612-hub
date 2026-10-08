import { useEffect, useRef, type CSSProperties, type RefObject, type SyntheticEvent } from "react";
import type { Settings } from "./types";

export const FRAME_SIZES: Record<Settings["frame"], [number, number]> = {
  "9:16": [9, 16],
  "16:9": [16, 9],
  "1:1": [1, 1],
  "4:5": [4, 5],
};

function plateBox(srcW: number, srcH: number, frameW: number, frameH: number, layout: Settings["layout"]) {
  if (layout === "crop" || !srcW || !srcH) {
    return { width: "100%", height: "100%" };
  }
  const scale = Math.min(frameW / srcW, frameH / srcH);
  return {
    width: `${((srcW * scale) / frameW) * 100}%`,
    height: `${((srcH * scale) / frameH) * 100}%`,
  };
}

export default function FitStage({
  videoRef,
  src,
  poster,
  settings,
  srcWidth,
  srcHeight,
  logoUrl,
  credit,
  captionWords = [],
  currentTime = 0,
  showSafeZones = false,
  onTimeUpdate,
  onPlay,
  onPause,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  src: string;
  poster?: string;
  settings: Settings;
  srcWidth: number;
  srcHeight: number;
  logoUrl?: string;
  credit: string;
  captionWords?: { word: string; start: number; end: number }[];
  currentTime?: number;
  showSafeZones?: boolean;
  onTimeUpdate: () => void;
  onPlay: () => void;
  onPause: () => void;
}) {
  const bgRef = useRef<HTMLVideoElement>(null);
  const [fw, fh] = FRAME_SIZES[settings.frame] || FRAME_SIZES["9:16"];
  const plate = plateBox(srcWidth, srcHeight, fw, fh, settings.layout);
  const logoCorner = settings.credit_corner === "br" ? "bl" : "br";
  const blur = settings.layout === "blur";
  const position = settings.caption_position || (settings.caption_style === "hook" ? "blur" : "lower");
  const size = settings.caption_size || "m";
  const karaoke = settings.caption_karaoke !== false;
  const uppercase = Boolean(settings.caption_uppercase);
  const active = settings.caption_active || "#f5a524";
  const rest = settings.caption_rest || "#ffffff";
  const boxed = settings.caption_style === "boxed";

  const syncBg = (from: HTMLVideoElement) => {
    const bg = bgRef.current;
    if (!bg || bg === from) return;
    if (Math.abs(bg.currentTime - from.currentTime) > 0.1) {
      bg.currentTime = from.currentTime;
    }
  };

  useEffect(() => {
    const fg = videoRef.current;
    const bg = bgRef.current;
    if (fg && bg) bg.currentTime = fg.currentTime;
  }, [src, settings.frame, settings.layout, videoRef]);

  const handleTime = (event: SyntheticEvent<HTMLVideoElement>) => {
    syncBg(event.currentTarget);
    onTimeUpdate();
  };

  const handlePlay = () => {
    void bgRef.current?.play().catch(() => undefined);
    onPlay();
  };

  const handlePause = () => {
    bgRef.current?.pause();
    onPause();
  };

  const posClass =
    position === "center" ? "pos-center" : position === "lower" ? "pos-lower" : "pos-blur";

  return (
    <div
      className="fit"
      style={
        {
          "--fit-w": fw,
          "--fit-h": fh,
          "--fit-border": settings.border_color || "#c084fc",
          "--cap-active": active,
          "--cap-rest": rest,
        } as CSSProperties
      }
      onClick={() => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) void video.play();
        else video.pause();
      }}
    >
      {blur && (
        <video
          ref={bgRef}
          className="fit-bg"
          src={src}
          poster={poster}
          muted
          playsInline
          preload="metadata"
        />
      )}
      <div
        className={`fit-plate ${settings.border} ${blur ? "contained" : "cover"}`}
        style={plate}
      >
        <video
          ref={videoRef}
          className={blur ? "fit-fg" : "fit-fg cover"}
          src={src}
          poster={poster}
          playsInline
          onTimeUpdate={handleTime}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeeked={(e) => syncBg(e.currentTarget)}
        />
      </div>
      {credit.trim() && (
        <span className={`fit-credit ${settings.credit_corner}`}>{credit.trim()}</span>
      )}
      {logoUrl && <img className={`fit-logo ${logoCorner}`} src={logoUrl} alt="" />}
      {showSafeZones && <div className="fit-safe" aria-hidden />}
      {captionWords && captionWords.length > 0 && (
        <div
          className={`fit-captions ${posClass} size-${size}${boxed ? " boxed" : ""}${
            settings.caption_style === "minimal" ? " minimal" : ""
          } font-${settings.caption_font || "inter"}`}
        >
          {captionWords.map((word, i) => {
            const on = karaoke && currentTime >= word.start && currentTime < word.end;
            const done = karaoke && currentTime >= word.end;
            const label = uppercase ? word.word.toUpperCase() : word.word;
            return (
              <span key={`${word.start}-${i}`} className={on ? "on" : done ? "done" : ""}>
                {label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
