import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wavDurationSec } from "../wav";
import type { SynthesisResult, VoiceAdapter } from "./types";

/**
 * macOS標準TTSのフォールバックアダプタ。依存ゼロで動くが声にミーム感はない。
 * 話者キーはmacOSのボイス名(Kyoko, O-Ren等)。デフォルトはKyoko(日本語)。
 */

const DEFAULT_VOICE = "Kyoko";
const BASE_RATE_WPM = 200;

export const sayAdapter: VoiceAdapter = {
  name: "say",

  async available() {
    if (process.platform !== "darwin") return "say adapter is macOS only";
    return true;
  },

  async synthesize(text, { speaker, speed }): Promise<SynthesisResult> {
    const voice = speaker === "zundamon" || speaker === "default" ? DEFAULT_VOICE : speaker;
    const dir = mkdtempSync(join(tmpdir(), "dopa-say-"));
    const out = join(dir, "voice.wav");
    try {
      execFileSync("say", [
        "-v", voice,
        "-o", out,
        "--data-format=LEI16@22050",
        "-r", String(Math.round(BASE_RATE_WPM * speed)),
        text,
      ]);
      const wav = readFileSync(out);
      return { wav, durationSec: wavDurationSec(wav) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};
