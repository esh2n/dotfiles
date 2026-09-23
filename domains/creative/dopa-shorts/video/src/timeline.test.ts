import { describe, expect, it } from "vitest";
import { scriptSchema, type VoiceManifest } from "./schema";
import {
  absoluteSpeechIntervals,
  buildTimeline,
  estimateDurationSec,
  isSpeakingAt,
  PAUSE_AFTER_SEC,
  PRE_PAD_SEC,
} from "./timeline";

const FPS = 30;

const baseScript = scriptSchema.parse({
  meta: { title: "test" },
  cuts: [
    { type: "hook", text: "全人類が誤解してるのだ", telop: "全人類が誤解" },
    { type: "body", text: "理由はこうなのだ", telop: "理由" },
    { type: "punch", text: "つまりそういうことなのだ", telop: "オチ" },
  ],
});

const manifest: VoiceManifest = {
  adapter: "voicevox",
  voice: "zundamon",
  speed: 1.15,
  cuts: [
    { file: "voices/test/000.wav", durationSec: 2.0, speech: [{ start: 0.1, end: 1.9 }] },
    { file: "voices/test/001.wav", durationSec: 1.0 },
    { file: "voices/test/002.wav", durationSec: 1.5 },
  ],
};

describe("estimateDurationSec", () => {
  it("clamps to [1.0, 8.0]", () => {
    expect(estimateDurationSec("あ")).toBe(1.0);
    expect(estimateDurationSec("あ".repeat(200))).toBe(8.0);
  });

  it("scales with text length", () => {
    expect(estimateDurationSec("あ".repeat(20))).toBeCloseTo(2.9, 5);
  });
});

describe("buildTimeline", () => {
  it("derives cut duration from wav length, not from the script", () => {
    const tl = buildTimeline(baseScript, manifest, FPS);
    const first = tl.cuts[0];
    expect(first.voiceFrames).toBe(Math.ceil(2.0 * FPS));
    expect(first.voiceStartFrame).toBe(Math.ceil(PRE_PAD_SEC * FPS));
    expect(first.durationFrames).toBe(
      first.voiceStartFrame + first.voiceFrames + Math.ceil(PAUSE_AFTER_SEC.hook * FPS),
    );
  });

  it("accumulates start frames sequentially", () => {
    const tl = buildTimeline(baseScript, manifest, FPS);
    expect(tl.cuts[0].startFrame).toBe(0);
    expect(tl.cuts[1].startFrame).toBe(tl.cuts[0].durationFrames);
    expect(tl.cuts[2].startFrame).toBe(
      tl.cuts[0].durationFrames + tl.cuts[1].durationFrames,
    );
    expect(tl.totalFrames).toBeGreaterThan(tl.cuts[2].startFrame + tl.cuts[2].durationFrames);
  });

  it("applies per-type pause defaults, punch longer than body", () => {
    const tl = buildTimeline(baseScript, manifest, FPS);
    const frames = (t: "hook" | "body" | "punch") => Math.ceil(PAUSE_AFTER_SEC[t] * FPS);
    expect(frames("punch")).toBeGreaterThan(frames("body"));
    expect(tl.cuts[2].durationFrames - tl.cuts[2].voiceStartFrame - tl.cuts[2].voiceFrames).toBe(
      frames("punch"),
    );
  });

  it("respects explicit pauseAfterSec override", () => {
    const script = scriptSchema.parse({
      meta: { title: "test" },
      cuts: [{ text: "間を置くのだ", telop: "間", pauseAfterSec: 1.0 }],
    });
    const tl = buildTimeline(script, null, FPS);
    const c = tl.cuts[0];
    expect(c.durationFrames - c.voiceStartFrame - c.voiceFrames).toBe(FPS);
  });

  it("falls back to text-length estimation without a manifest", () => {
    const tl = buildTimeline(baseScript, null, FPS);
    expect(tl.cuts[0].voiceFrames).toBe(
      Math.ceil(estimateDurationSec(baseScript.cuts[0].text) * FPS),
    );
  });

  it("approximates speech interval as full voice range when timings are missing", () => {
    const tl = buildTimeline(baseScript, manifest, FPS);
    const noTimings = tl.cuts[1];
    expect(noTimings.speechFrames).toEqual([
      { start: noTimings.voiceStartFrame, end: noTimings.voiceStartFrame + noTimings.voiceFrames },
    ]);
  });

  it("converts mora-based speech intervals to frames", () => {
    const tl = buildTimeline(baseScript, manifest, FPS);
    const withTimings = tl.cuts[0];
    expect(withTimings.speechFrames).toEqual([
      {
        start: withTimings.voiceStartFrame + Math.floor(0.1 * FPS),
        end: withTimings.voiceStartFrame + Math.ceil(1.9 * FPS),
      },
    ]);
  });
});

describe("speech interval helpers", () => {
  it("maps intervals to absolute frames and answers isSpeakingAt", () => {
    const tl = buildTimeline(baseScript, manifest, FPS);
    const abs = absoluteSpeechIntervals(tl);
    expect(abs).toHaveLength(3);
    const first = abs[0];
    expect(isSpeakingAt(abs, first.start)).toBe(true);
    expect(isSpeakingAt(abs, first.end)).toBe(false);
  });
});
