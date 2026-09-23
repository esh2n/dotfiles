import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

/** 強遷移用ホワイトフラッシュ(カット頭5フレーム) */
export const Flash: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 5], [1, 0], { extrapolateRight: "clamp" });
  if (opacity <= 0) return null;
  return <AbsoluteFill style={{ background: "#ffffff", opacity }} />;
};
