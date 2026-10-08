import { useEffect, useRef } from "react";
import { Disc3 } from "lucide-react";
import { useArt } from "../lib/art";
import { glowFromImage } from "../lib/color";

type Props = {
  id?: string | null;
  className?: string;
  onGlow?: (color: string) => void;
};

export function Cover({ id, className = "", onGlow }: Props) {
  const url = useArt(id);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!onGlow) return;
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth) onGlow(glowFromImage(img));
  }, [url, onGlow]);

  if (!url) {
    return (
      <div className={`cover cover-empty ${className}`}>
        <Disc3 size={22} strokeWidth={1.4} />
      </div>
    );
  }

  return (
    <img
      ref={imgRef}
      className={`cover ${className}`}
      src={url}
      alt=""
      draggable={false}
      onLoad={(e) => onGlow?.(glowFromImage(e.currentTarget))}
    />
  );
}
