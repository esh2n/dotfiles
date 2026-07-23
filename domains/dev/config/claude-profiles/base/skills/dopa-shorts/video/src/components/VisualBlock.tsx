import { Img, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Visual } from "../schema";

/** カットの挿し込みビジュアル(画像 or 図解テキスト) */
export const VisualBlock: React.FC<{
  visual: Visual;
  top: number;
  height: number;
}> = ({ visual, top, height }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const appear = spring({ frame, fps, config: { damping: 14, stiffness: 200 }, durationInFrames: 12 });

  return (
    <div
      style={{
        position: "absolute",
        top,
        left: 40,
        right: 40,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transform: `scale(${0.7 + 0.3 * appear})`,
        opacity: appear,
      }}
    >
      {visual.kind === "image" && visual.src ? (
        <Img
          src={staticFile(visual.src)}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            borderRadius: 24,
            boxShadow: "0 12px 60px rgba(0,0,0,0.5)",
          }}
        />
      ) : (
        <div
          style={{
            fontSize: 64,
            fontWeight: 900,
            color: "#ffffff",
            textAlign: "center",
            whiteSpace: "pre-wrap",
            lineHeight: 1.3,
            background: "rgba(0,0,0,0.35)",
            borderRadius: 24,
            padding: "40px 48px",
          }}
        >
          {visual.text ?? ""}
        </div>
      )}
    </div>
  );
};
