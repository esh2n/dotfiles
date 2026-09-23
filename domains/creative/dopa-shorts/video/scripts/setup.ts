/**
 * 初回セットアップ: 素材ダウンロード + プレースホルダーSE生成 + 環境チェック
 *
 * 使い方: pnpm bootstrap
 * (npmスクリプト名は"setup"にしないこと — pnpmの予約コマンドと衝突し、
 *  pnpm自身のsetupが走って~/.zshrcを書き換えてしまう)
 *
 * 立ち絵・SE・BGMは権利の都合でリポジトリに同梱しない。
 * - 立ち絵: MITテンプレートrepoの口パク差分PNGをダウンロード
 *   (ずんだもん等キャラクターの利用規約は各公式に従うこと)
 * - SE: ffmpegで合成したプレースホルダー。効果音ラボ等の素材に差し替え推奨
 * - BGM: 自動取得しない。public/bgm/ に手動配置
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VIDEO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUB = join(VIDEO_ROOT, "public");

const CHARACTER_BASE =
  "https://raw.githubusercontent.com/nyanko3141592/remotion-voicevox-template/master/public/images";
const CHARACTERS = ["zundamon", "metan"];
const MOUTH_FILES = ["mouth_open.png", "mouth_close.png"];

/** name → ffmpeg lavfi式(プレースホルダーSE) */
const PLACEHOLDER_SE: Record<string, string[]> = {
  don: ["-f", "lavfi", "-i", "sine=frequency=55:duration=0.35", "-af", "volume=2.5,afade=t=out:st=0.02:d=0.33"],
  pop: ["-f", "lavfi", "-i", "sine=frequency=900:duration=0.09", "-af", "volume=1.2,afade=t=out:st=0.02:d=0.07"],
  shakin: ["-f", "lavfi", "-i", "anoisesrc=duration=0.25:color=white:amplitude=0.5", "-af", "highpass=f=4000,afade=t=out:st=0.03:d=0.22"],
  whoosh: ["-f", "lavfi", "-i", "anoisesrc=duration=0.3:color=pink:amplitude=0.6", "-af", "lowpass=f=1200,afade=t=in:st=0:d=0.1,afade=t=out:st=0.15:d=0.15"],
};

function hasCommand(cmd: string): boolean {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function downloadCharacters(): Promise<void> {
  console.log("== 立ち絵(口パク差分) ==");
  for (const chara of CHARACTERS) {
    const dir = join(PUB, "images", chara);
    mkdirSync(dir, { recursive: true });
    for (const file of MOUTH_FILES) {
      const dest = join(dir, file);
      if (existsSync(dest)) {
        console.log(`  skip (exists): images/${chara}/${file}`);
        continue;
      }
      const url = `${CHARACTER_BASE}/${chara}/${file}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`  NG: ${url} (${res.status}) — 手動で ${dest} に配置してください`);
        continue;
      }
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      console.log(`  ok: images/${chara}/${file}`);
    }
  }
  console.log("  注: キャラクター画像の利用は各公式の規約に従ってください");
  console.log("      (表情差分を足す場合は images/<chara>/<emotion>_open.png 等を追加)");
}

function generatePlaceholderSe(): void {
  console.log("== 効果音(プレースホルダー) ==");
  if (!hasCommand("ffmpeg")) {
    console.warn("  ffmpegがないためSE生成をスキップ (brew等で導入後に再実行)");
    return;
  }
  const dir = join(PUB, "se");
  mkdirSync(dir, { recursive: true });
  for (const [name, filterArgs] of Object.entries(PLACEHOLDER_SE)) {
    const dest = join(dir, `${name}.wav`);
    if (existsSync(dest)) {
      console.log(`  skip (exists): se/${name}.wav`);
      continue;
    }
    execFileSync("ffmpeg", ["-y", ...filterArgs, "-ar", "44100", dest], { stdio: "ignore" });
    console.log(`  ok: se/${name}.wav (合成プレースホルダー)`);
  }
  console.log("  推奨: 効果音ラボ https://soundeffect-lab.info/ 等の素材に手動で差し替え");
}

async function checkVoicevox(): Promise<void> {
  console.log("== VOICEVOX ==");
  const host = process.env.VOICEVOX_HOST ?? "http://localhost:50021";
  try {
    const res = await fetch(`${host}/version`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      console.log(`  ok: VOICEVOX Engine ${await res.text()} (${host})`);
      return;
    }
  } catch {
    // fallthrough
  }
  console.warn(`  未起動: ${host}`);
  console.warn("  起動: open -a VOICEVOX / 未導入なら https://voicevox.hiroshiba.jp/");
  console.warn('  (音声なしで試すなら meta.adapter: "say" か render --no-voice)');
}

async function main() {
  await downloadCharacters();
  generatePlaceholderSe();
  await checkVoicevox();
  console.log("== BGM ==");
  console.log("  自動取得しません。public/bgm/ にmp3/wavを置き、台本の meta.bgm にファイル名を指定");
  console.log("  フリー素材: DOVA-SYNDROME https://dova-s.jp/ 等");
  console.log(
    "\nセットアップ完了。動作確認: pnpm test && pnpm render ../examples/sample-script.json --no-voice",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
