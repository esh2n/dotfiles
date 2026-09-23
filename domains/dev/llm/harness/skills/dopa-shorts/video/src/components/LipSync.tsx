import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import type { Emotion } from "../schema";

/**
 * 口パク+表情差分つき立ち絵。
 * speechFrames(カット先頭からの相対フレーム)内でのみ口を開閉する。
 * 画像は public/images/<characterId>/ から:
 *   mouth_open.png / mouth_close.png       — デフォルト表情
 *   <emotion>_open.png / <emotion>_close.png — 表情差分(あれば)
 * 表情差分の有無は availableImages で渡し、無ければデフォルトへフォールバック。
 */
export const LipSync: React.FC<{
  characterId: string;
  emotion: Emotion;
  speechFrames: Array<{ start: number; end: number }>;
  height: number;
  availableImages?: string[];
}> = ({ characterId, emotion, speechFrames, height, availableImages }) => {
  const frame = useCurrentFrame();

  const isSpeaking = speechFrames.some((s) => frame >= s.start && frame < s.end);
  // 発話中は約4フレーム周期で口を開閉
  const mouthOpen = isSpeaking && Math.floor(frame / 4) % 2 === 0;

  const state = mouthOpen ? "open" : "close";
  const emotionFile = `${emotion}_${state}.png`;
  const fileName =
    emotion !== "normal" && availableImages?.includes(emotionFile)
      ? emotionFile
      : `mouth_${state}.png`;

  // 発話中は軽く上下に揺れる
  const bounceY = isSpeaking ? interpolate(Math.sin(frame * 0.55), [-1, 1], [-6, 6]) : 0;

  return (
    <Img
      src={staticFile(`images/${characterId}/${fileName}`)}
      style={{
        height,
        objectFit: "contain",
        transform: `translateY(${bounceY}px)`,
      }}
    />
  );
};
