import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CutType } from "../schema";
import type { Entrance } from "./entrance";

const TYPE_COLOR: Record<CutType, string> = {
  hook: "#ffe600",
  body: "#ffffff",
  punch: "#ff3b3b",
};

/** 白フチ+黒フチの二重縁取り(定番テロップスタイル)。CSSのtext-shadow多重打ちで作る */
function outline(color: string, width: number): string {
  const shadows: string[] = [];
  for (let dx = -width; dx <= width; dx += 2) {
    for (let dy = -width; dy <= width; dy += 2) {
      if (dx === 0 && dy === 0) continue;
      shadows.push(`${dx}px ${dy}px 0 ${color}`);
    }
  }
  return shadows.join(", ");
}

export const Telop: React.FC<{
  text: string;
  type: CutType;
  entrance: Entrance;
  /** 画面上端/下端からの位置(px)。どちらか一方を指定 */
  top?: number;
  bottom?: number;
  fontSize?: number;
}> = ({ text, type, entrance, top, bottom, fontSize = 92 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pop = spring({ frame, fps, config: { damping: 11, stiffness: 240 }, durationInFrames: 14 });
  const scale =
    entrance === "flash-zoom"
      ? interpolate(pop, [0, 1], [1.6, 1])
      : interpolate(pop, [0, 1], [0.3, 1]);
  const translateY = entrance === "slide-up" ? interpolate(pop, [0, 1], [80, 0]) : 0;

  return (
    <div
      style={{
        position: "absolute",
        ...(top !== undefined ? { top } : { bottom }),
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        padding: "0 40px",
      }}
    >
      <div
        style={{
          transform: `scale(${scale}) translateY(${translateY}px)`,
          fontSize,
          fontWeight: 900,
          lineHeight: 1.15,
          textAlign: "center",
          color: TYPE_COLOR[type],
          textShadow: outline("#000000", 10),
          whiteSpace: "pre-wrap",
        }}
      >
        {text}
      </div>
    </div>
  );
};
