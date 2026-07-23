import { AbsoluteFill, Sequence } from "remotion";
import { AudioTrack } from "../components/AudioTrack";
import { entranceFor } from "../components/entrance";
import { Flash } from "../components/Flash";
import { LipSync } from "../components/LipSync";
import { Telop } from "../components/Telop";
import { VisualBlock } from "../components/VisualBlock";
import { SAFE_AREA, VIDEO } from "../config";
import type { Script, VoiceManifest } from "../schema";
import type { Timeline } from "../timeline";

/**
 * 立ち絵解説テンプレート(ずんだもん解説の縦動画版)。
 * レイアウト(上から): でかテロップ(セーフエリア直下) → 中央: 図解 or セリフ字幕 → 立ち絵(右下)
 */

/** カットindexごとに背景の色相を回して「画変化」を作る */
const BACKGROUNDS = [
  "linear-gradient(180deg, #1a2a1a 0%, #0c140c 100%)",
  "linear-gradient(180deg, #16213a 0%, #0a0f1e 100%)",
  "linear-gradient(180deg, #33201a 0%, #170d0a 100%)",
  "linear-gradient(180deg, #2a1a33 0%, #130a18 100%)",
];

export const ZundaTemplate: React.FC<{
  script: Script;
  timeline: Timeline;
  voices: VoiceManifest | null;
}> = ({ script, timeline, voices }) => {
  return (
    <AbsoluteFill style={{ background: "#0c140c" }}>
      <AudioTrack timeline={timeline} voices={voices} bgm={script.meta.bgm} />

      {timeline.cuts.map((tc) => {
        const { cut, index } = tc;
        const entrance = entranceFor(cut, index);
        const characterId = cut.speaker ?? script.meta.voice;

        return (
          <Sequence key={index} from={tc.startFrame} durationInFrames={tc.durationFrames}>
            <AbsoluteFill style={{ background: BACKGROUNDS[index % BACKGROUNDS.length] }} />

            <Telop text={cut.telop} type={cut.type} entrance={entrance} top={SAFE_AREA.top + 20} />

            {/* 中央: 図解があれば図解、なければセリフ全文字幕(ミュート視聴対策) */}
            {cut.visual ? (
              <VisualBlock
                visual={cut.visual}
                top={VIDEO.height * 0.38}
                height={VIDEO.height * 0.28}
              />
            ) : (
              <div
                style={{
                  position: "absolute",
                  top: VIDEO.height * 0.42,
                  left: 70,
                  right: 70,
                  textAlign: "center",
                  fontSize: 56,
                  fontWeight: 700,
                  lineHeight: 1.5,
                  color: "#ffffff",
                  opacity: 0.92,
                  textShadow: "0 4px 24px rgba(0,0,0,0.8)",
                }}
              >
                {cut.text}
              </div>
            )}

            <div style={{ position: "absolute", bottom: 40, right: 30 }}>
              <LipSync
                characterId={characterId}
                emotion={cut.emotion}
                speechFrames={tc.speechFrames}
                height={620}
              />
            </div>

            {entrance === "flash-zoom" && <Flash />}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
