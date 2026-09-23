import { AbsoluteFill, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { AudioTrack } from "../components/AudioTrack";
import { entranceFor } from "../components/entrance";
import { Flash } from "../components/Flash";
import { SAFE_AREA, VIDEO } from "../config";
import type { Cut, CutType, Script, VoiceManifest } from "../schema";
import type { Timeline, TimelineCut } from "../timeline";
import { VisualBlock } from "../components/VisualBlock";

/**
 * キネティックタイポテンプレート。キャラ素材ゼロ、文字の勢いだけで殴る。
 * 背景色はカットごとにパレットを巡回して「画変化」を作る。
 */

const PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: "#111111", fg: "#ffe600" },
  { bg: "#ffe600", fg: "#111111" },
  { bg: "#161629", fg: "#ffffff" },
  { bg: "#e8322e", fg: "#ffffff" },
];

const TYPE_FG: Partial<Record<CutType, string>> = {
  punch: "#ff3b3b",
};

/** テロップ長に応じてフォントサイズを自動調整 */
function fitFontSize(text: string): number {
  const longest = Math.max(...text.split("\n").map((l) => l.length));
  return Math.max(64, Math.min(150, Math.floor((VIDEO.width * 0.92) / Math.max(longest, 1))));
}

const KineticCut: React.FC<{ tc: TimelineCut; palette: { bg: string; fg: string } }> = ({
  tc,
  palette,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { cut, index } = tc;
  const entrance = entranceFor(cut, index);

  const pop = spring({ frame, fps, config: { damping: 10, stiffness: 260 }, durationInFrames: 12 });
  const scale =
    entrance === "flash-zoom" ? interpolate(pop, [0, 1], [2.2, 1]) : interpolate(pop, [0, 1], [0.2, 1]);
  const rotation = interpolate(pop, [0, 1], [index % 2 === 0 ? -6 : 6, index % 2 === 0 ? -1.5 : 1.5]);
  // 発話中は微振動でテンションを保つ
  const isSpeaking = tc.speechFrames.some((s) => frame >= s.start && frame < s.end);
  const jitter = isSpeaking ? Math.sin(frame * 1.7) * 2 : 0;

  const fg = TYPE_FG[cut.type] && palette.bg !== "#e8322e" ? TYPE_FG[cut.type]! : palette.fg;

  return (
    <AbsoluteFill style={{ background: palette.bg }}>
      {cut.visual && (
        <VisualBlock visual={cut.visual} top={SAFE_AREA.top} height={VIDEO.height * 0.26} />
      )}

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "0 44px" }}>
        <div
          style={{
            transform: `scale(${scale}) rotate(${rotation}deg) translateY(${jitter}px)`,
            fontSize: fitFontSize(cut.telop),
            fontWeight: 900,
            lineHeight: 1.12,
            textAlign: "center",
            color: fg,
            whiteSpace: "pre-wrap",
          }}
        >
          {cut.telop}
        </div>
      </AbsoluteFill>

      {/* セリフ全文の小字幕(下部セーフエリア内ぎりぎり上) */}
      <div
        style={{
          position: "absolute",
          bottom: SAFE_AREA.bottom + 20,
          left: 60,
          right: 60,
          textAlign: "center",
          fontSize: 40,
          fontWeight: 700,
          color: fg,
          opacity: 0.72,
        }}
      >
        {cut.text}
      </div>

      {entrance === "flash-zoom" && <Flash />}
    </AbsoluteFill>
  );
};

export const KineticTemplate: React.FC<{
  script: Script;
  timeline: Timeline;
  voices: VoiceManifest | null;
}> = ({ script, timeline, voices }) => {
  return (
    <AbsoluteFill style={{ background: PALETTE[0].bg }}>
      <AudioTrack timeline={timeline} voices={voices} bgm={script.meta.bgm} />
      {timeline.cuts.map((tc) => (
        <Sequence key={tc.index} from={tc.startFrame} durationInFrames={tc.durationFrames}>
          <KineticCut tc={tc} palette={PALETTE[tc.index % PALETTE.length]} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
