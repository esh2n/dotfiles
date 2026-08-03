import { Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { BGM_VOLUME } from "../config";
import type { VoiceManifest } from "../schema";
import { absoluteSpeechIntervals, isSpeakingAt, type Timeline } from "../timeline";

/**
 * 音声レイヤー: セリフwav + SE + BGM(セリフ中ダッキング)。
 * voices が null(--no-voice プレビュー)のときはSE/BGMのみ鳴らす。
 */
export const AudioTrack: React.FC<{
  timeline: Timeline;
  voices: VoiceManifest | null;
  bgm?: string | null;
}> = ({ timeline, voices, bgm }) => {
  const { fps } = useVideoConfig();
  const speechAbs = absoluteSpeechIntervals(timeline);

  return (
    <>
      {bgm && (
        <Audio
          src={staticFile(`bgm/${bgm}`)}
          loop
          volume={(f) =>
            voices && isSpeakingAt(speechAbs, f) ? BGM_VOLUME.ducked : BGM_VOLUME.normal
          }
        />
      )}

      {timeline.cuts.map((tc) => (
        <Sequence
          key={`audio-${tc.index}`}
          from={tc.startFrame}
          durationInFrames={tc.durationFrames}
          premountFor={fps}
        >
          {voices && (
            <Sequence from={tc.voiceStartFrame} durationInFrames={tc.voiceFrames}>
              <Audio src={staticFile(voices.cuts[tc.index].file)} />
            </Sequence>
          )}
          {tc.cut.se && <Audio src={staticFile(`se/${tc.cut.se}.wav`)} volume={0.9} />}
        </Sequence>
      ))}
    </>
  );
};
