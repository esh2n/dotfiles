import type { SpeechInterval } from "../../../src/schema";
import { wavDurationSec } from "../wav";
import type { SynthesisResult, VoiceAdapter } from "./types";

const HOST = process.env.VOICEVOX_HOST ?? "http://localhost:50021";

/** 話者キー → VOICEVOXスタイルID(ノーマル) */
export const VOICEVOX_SPEAKERS: Record<string, number> = {
  zundamon: 3,
  metan: 2,
  tsumugi: 8,
  ritsu: 9,
  hau: 10,
  sora: 16,
};

interface Mora {
  consonant_length: number | null;
  vowel_length: number;
  vowel: string;
}

interface AccentPhrase {
  moras: Mora[];
  pause_mora: Mora | null;
}

interface AudioQuery {
  accent_phrases: AccentPhrase[];
  speedScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
  [key: string]: unknown;
}

function resolveSpeakerId(speaker: string): number {
  const id = /^\d+$/.test(speaker) ? Number(speaker) : VOICEVOX_SPEAKERS[speaker];
  if (id === undefined) {
    throw new Error(
      `unknown voicevox speaker: "${speaker}" (known: ${Object.keys(VOICEVOX_SPEAKERS).join(", ")}, or a numeric style id)`,
    );
  }
  return id;
}

/**
 * audio_queryのモーラ長から発話区間(秒)を計算する。
 * クエリ内の長さはspeedScale=1基準なので、適用後の時刻はspeedで割る。
 * pause_mora(句読点の間)で区間を分割し、口パクが「間」で閉じるようにする。
 */
export function speechIntervalsFromQuery(query: AudioQuery, speed: number): SpeechInterval[] {
  const intervals: SpeechInterval[] = [];
  let t = query.prePhonemeLength;
  let segStart: number | null = null;

  const closeSegment = () => {
    if (segStart !== null) {
      intervals.push({ start: segStart / speed, end: t / speed });
      segStart = null;
    }
  };

  for (const phrase of query.accent_phrases) {
    for (const mora of phrase.moras) {
      if (segStart === null) segStart = t;
      t += (mora.consonant_length ?? 0) + mora.vowel_length;
    }
    if (phrase.pause_mora) {
      closeSegment();
      t += (phrase.pause_mora.consonant_length ?? 0) + phrase.pause_mora.vowel_length;
    }
  }
  closeSegment();
  return intervals;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${HOST}${path}`, init);
  if (!res.ok) {
    throw new Error(`VOICEVOX ${path} failed: ${res.status} ${res.statusText}`);
  }
  return (res.headers.get("content-type")?.includes("json")
    ? res.json()
    : res.arrayBuffer()) as Promise<T>;
}

export const voicevoxAdapter: VoiceAdapter = {
  name: "voicevox",

  async available() {
    try {
      const res = await fetch(`${HOST}/version`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // fallthrough
    }
    return [
      `VOICEVOX Engine (${HOST}) に接続できません。`,
      "起動: open -a VOICEVOX",
      "未インストールなら: https://voicevox.hiroshiba.jp/ からダウンロード",
    ].join("\n");
  },

  async synthesize(text, { speaker, speed }): Promise<SynthesisResult> {
    const speakerId = resolveSpeakerId(speaker);

    const query = await api<AudioQuery>(
      `/audio_query?speaker=${speakerId}&text=${encodeURIComponent(text)}`,
      { method: "POST" },
    );
    query.speedScale = speed;
    // カット間の間はタイムライン側で管理するので、音声自体の前後余白は詰める
    query.prePhonemeLength = 0.05;
    query.postPhonemeLength = 0.05;

    const audio = await api<ArrayBuffer>(`/synthesis?speaker=${speakerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    });

    const wav = Buffer.from(audio);
    return {
      wav,
      durationSec: wavDurationSec(wav),
      speech: speechIntervalsFromQuery(query, speed),
    };
  },
};
