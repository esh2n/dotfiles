import { z } from "zod";

/**
 * 台本スキーマ — dopa-shortsパイプライン全体の唯一の契約。
 * 台本JSON(script.json)はこのスキーマでバリデーションしてから
 * 音声生成・レンダリングに渡す。
 */

export const cutTypeSchema = z.enum(["hook", "body", "punch"]);
export type CutType = z.infer<typeof cutTypeSchema>;

export const emotionSchema = z.enum([
  "normal",
  "happy",
  "surprised",
  "thinking",
  "sad",
  "angry",
]);
export type Emotion = z.infer<typeof emotionSchema>;

export const visualSchema = z.object({
  kind: z.enum(["image", "text"]),
  /** kind=image のとき: video/public/ からの相対パス */
  src: z.string().optional(),
  /** kind=text のとき: 表示テキスト */
  text: z.string().optional(),
});
export type Visual = z.infer<typeof visualSchema>;

export const cutSchema = z.object({
  type: cutTypeSchema.default("body"),
  /** 省略時は meta.voice の話者 */
  speaker: z.string().optional(),
  /** セリフ全文(字幕表示用。readingが無ければTTS入力にもなる) */
  text: z.string().min(1),
  /** TTS用のよみ。英語・専門用語の読み間違い対策(例: OAuth2→オーオースツー) */
  reading: z.string().min(1).optional(),
  /** 画面テロップ。セリフより短く強く(3〜10文字目安) */
  telop: z.string().min(1),
  emotion: emotionSchema.default("normal"),
  /** 効果音cue: public/se/<name>.wav を再生 */
  se: z.string().optional(),
  /** カット後の間(秒)。省略時はtypeごとのデフォルト */
  pauseAfterSec: z.number().min(0).max(3).optional(),
  visual: visualSchema.optional(),
});
export type Cut = z.infer<typeof cutSchema>;

export const metaSchema = z.object({
  title: z.string().min(1),
  /** レンダリングテンプレート */
  style: z.enum(["zunda", "kinetic"]).default("zunda"),
  /** デフォルト話者(アダプタごとの話者キー。voicevoxなら zundamon 等) */
  voice: z.string().default("zundamon"),
  adapter: z.enum(["voicevox", "coefont", "say"]).default("voicevox"),
  /** 話速。ドパガキ補正でデフォルト1.15倍 */
  speed: z.number().min(0.8).max(2).default(1.15),
  /** public/bgm/ 内のファイル名。null/省略でBGMなし */
  bgm: z.string().nullable().optional(),
  /** 出力ファイル名などに使うslug。省略時はtitleから生成 */
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
});
export type Meta = z.infer<typeof metaSchema>;

export const scriptSchema = z.object({
  meta: metaSchema,
  cuts: z.array(cutSchema).min(1).max(60),
});
export type Script = z.infer<typeof scriptSchema>;

/** 音声区間(秒)。口パク・BGMダッキングに使う */
export interface SpeechInterval {
  start: number;
  end: number;
}

/** gen-voice.ts が出力する manifest.json のカットごとの情報 */
export interface VoiceCutInfo {
  /** video/public/ からの相対パス */
  file: string;
  durationSec: number;
  /** モーラタイミング由来の発話区間。無ければwav全長で近似 */
  speech?: SpeechInterval[];
}

export interface VoiceManifest {
  adapter: string;
  voice: string;
  speed: number;
  cuts: VoiceCutInfo[];
}

export function slugify(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii.length >= 3) return ascii.slice(0, 40);
  // 日本語タイトル等でasciiが残らない場合はハッシュで安定したslugを作る
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return `video-${hash.toString(36)}`;
}
