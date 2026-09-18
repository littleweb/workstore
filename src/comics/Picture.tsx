import { useEffect, useState, useId } from "react";
import type { Picture as PictureValue } from "./types";
import { imageSource } from "./images";
export default function Picture({
  value,
  alt = "",
  className = "",
  fit = "cover",
}: {
  value?: PictureValue;
  alt?: string;
  className?: string;
  fit?: "contain" | "cover";
}) {
  const clipId = "comic-clip-" + useId().replace(/:/g, "");
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState({ width: 1, height: 1 });
  useEffect(() => {
    let live = true;
    setSrc("");
    setFailed(false);
    if (value)
      void imageSource(value.src)
        .then(async (s) => {
          const image = new Image();
          image.src = s;
          await image.decode();
          if (live) {
            setSize({ width: image.naturalWidth, height: image.naturalHeight });
            setSrc(s);
          }
        })
        .catch(() => {
          if (live) setFailed(true);
        });
    return () => {
      live = false;
    };
  }, [value?.src]);
  if (!value || !src)
    return (
      <div className={`comic-picture empty ${className}`}>
        <span>
          {failed ? "图片读取失败" : value ? "正在读取…" : "等待绘制"}
        </span>
      </div>
    );
  const [x, y, w, h] = value.crop ?? [0, 0, 1, 1];
  return (
    <div
      role="img"
      aria-label={alt}
      className={`comic-picture ${className}`}
      style={{ overflow: "hidden" }}
    >
      <svg
        aria-hidden="true"
        width="100%"
        height="100%"
        viewBox={`${x * size.width} ${y * size.height} ${w * size.width} ${
          h * size.height
        }`}
        preserveAspectRatio={
          value.crop && fit !== "contain" ? "xMidYMid slice" : "xMidYMid meet"
        }
        style={{ position: "absolute", inset: 0, display: "block" }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect
              x={x * size.width}
              y={y * size.height}
              width={w * size.width}
              height={h * size.height}
            />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <image href={src} width={size.width} height={size.height} />
        </g>
      </svg>
    </div>
  );
}
