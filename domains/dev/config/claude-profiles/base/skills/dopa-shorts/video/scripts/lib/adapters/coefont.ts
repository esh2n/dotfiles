import { createHmac } from "node:crypto";
import { wavDurationSec } from "../wav";
import type { SynthesisResult, VoiceAdapter } from "./types";

/**
 * CoeFont APIアダプタ(ひろゆき等のクラウドボイス)。
 *
 * 必要な環境変数:
 *   COEFONT_ACCESS_KEY    — APIアクセスキー
 *   COEFONT_CLIENT_SECRET — 署名用シークレット
 *   COEFONT_VOICE_<NAME>  — 話者キー→CoeFont UUIDの解決(例: COEFONT_VOICE_HIROYUKI)
 *
 * 話者キーにUUIDを直接指定してもよい。
 * タイミング情報は取れないため、口パクはwav長からの近似になる。
 * 注意: API仕様(v2)は変わる可能性がある。失敗時はvoicevoxへの切替を案内する。
 */

const ENDPOINT = "https://api.coefont.cloud/v2/text2speech";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveCoefontId(speaker: string): string {
  if (UUID_RE.test(speaker)) return speaker;
  const envKey = `COEFONT_VOICE_${speaker.toUpperCase().replace(/-/g, "_")}`;
  const id = process.env[envKey];
  if (!id) {
    throw new Error(
      `CoeFont voice "${speaker}" が未解決です。環境変数 ${envKey} にCoeFont UUIDを設定するか、speakerにUUIDを直接指定してください。`,
    );
  }
  return id;
}

export const coefontAdapter: VoiceAdapter = {
  name: "coefont",

  async available() {
    if (!process.env.COEFONT_ACCESS_KEY || !process.env.COEFONT_CLIENT_SECRET) {
      return [
        "CoeFont APIの認証情報がありません。",
        "環境変数 COEFONT_ACCESS_KEY / COEFONT_CLIENT_SECRET を設定してください。",
        "(https://coefont.cloud/ のアカウント設定でAPI情報を発行)",
      ].join("\n");
    }
    return true;
  },

  async synthesize(text, { speaker, speed }): Promise<SynthesisResult> {
    const accessKey = process.env.COEFONT_ACCESS_KEY!;
    const secret = process.env.COEFONT_CLIENT_SECRET!;
    const body = JSON.stringify({
      coefont: resolveCoefontId(speaker),
      text,
      speed,
      format: "wav",
    });
    const date = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", secret).update(date + body).digest("hex");

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: accessKey,
        "X-Coefont-Date": date,
        "X-Coefont-Content": signature,
      },
      body,
    });
    if (!res.ok) {
      throw new Error(
        `CoeFont API failed: ${res.status} ${res.statusText}\n` +
          `→ 一時的な問題でなければ meta.adapter を "voicevox" に切り替えてください。`,
      );
    }

    const wav = Buffer.from(await res.arrayBuffer());
    return { wav, durationSec: wavDurationSec(wav) };
  },
};
