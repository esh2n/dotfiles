import type { Cut, CutType, Script, SpeechInterval, VoiceManifest } from "./schema";

/**
 * 台本 + 音声manifest → フレーム単位のタイムライン。
 * カット尺は音声長から自動決定する(台本に秒数は書かせない)。
 * manifestが無い場合(Studioプレビュー等)は文字数から尺を推定する。
 */

/** カット直後の「間」のデフォルト(秒)。punchは余韻を長く */
export const PAUSE_AFTER_SEC: Record<CutType, number> = {
  hook: 0.1,
  body: 0.18,
  punch: 0.45,
};

/** カット頭のパディング(秒) */
export const PRE_PAD_SEC = 0.08;

/** 動画末尾の余白(秒) */
const TAIL_SEC = 0.5;

export interface TimelineCut {
  cut: Cut;
  index: number;
  startFrame: number;
  /** カット全体の長さ(prePad + 音声 + pauseAfter) */
  durationFrames: number;
  /** 音声再生の開始(カット先頭からの相対フレーム) */
  voiceStartFrame: number;
  voiceFrames: number;
  /** 発話区間(カット先頭からの相対フレーム)。口パク用 */
  speechFrames: Array<{ start: number; end: number }>;
}

export interface Timeline {
  cuts: TimelineCut[];
  totalFrames: number;
}

/** manifestが無いときの尺推定: 日本語およそ7.5文字/秒 + 前後余白 */
export function estimateDurationSec(text: string): number {
  const sec = text.length * 0.13 + 0.3;
  return Math.min(Math.max(sec, 1.0), 8.0);
}

function toFrames(sec: number, fps: number): number {
  return Math.ceil(sec * fps);
}

function speechToFrames(
  speech: SpeechInterval[] | undefined,
  voiceStartFrame: number,
  voiceFrames: number,
  fps: number,
): Array<{ start: number; end: number }> {
  if (!speech || speech.length === 0) {
    return [{ start: voiceStartFrame, end: voiceStartFrame + voiceFrames }];
  }
  return speech.map((s) => ({
    start: voiceStartFrame + Math.floor(s.start * fps),
    end: voiceStartFrame + Math.ceil(s.end * fps),
  }));
}

export function buildTimeline(
  script: Script,
  voices: VoiceManifest | null | undefined,
  fps: number,
): Timeline {
  const cuts: TimelineCut[] = [];
  let cursor = 0;

  script.cuts.forEach((cut, index) => {
    const info = voices?.cuts[index];
    const durationSec = info?.durationSec ?? estimateDurationSec(cut.text);
    const voiceStartFrame = toFrames(PRE_PAD_SEC, fps);
    const voiceFrames = toFrames(durationSec, fps);
    const pauseSec = cut.pauseAfterSec ?? PAUSE_AFTER_SEC[cut.type];
    const durationFrames = voiceStartFrame + voiceFrames + toFrames(pauseSec, fps);

    cuts.push({
      cut,
      index,
      startFrame: cursor,
      durationFrames,
      voiceStartFrame,
      voiceFrames,
      speechFrames: speechToFrames(info?.speech, voiceStartFrame, voiceFrames, fps),
    });
    cursor += durationFrames;
  });

  return { cuts, totalFrames: cursor + toFrames(TAIL_SEC, fps) };
}

/** 絶対フレームで見た発話区間(BGMダッキング用) */
export function absoluteSpeechIntervals(
  timeline: Timeline,
): Array<{ start: number; end: number }> {
  return timeline.cuts.flatMap((tc) =>
    tc.speechFrames.map((s) => ({
      start: tc.startFrame + s.start,
      end: tc.startFrame + s.end,
    })),
  );
}

export function isSpeakingAt(
  intervals: Array<{ start: number; end: number }>,
  frame: number,
): boolean {
  return intervals.some((s) => frame >= s.start && frame < s.end);
}
