/**
 * 台本JSON + 生成済み音声 → mp4
 *
 * 使い方:
 *   pnpm render <script.json> [--draft] [--out <path>] [--no-voice]
 *
 *   --draft    低解像度・高圧縮の確認用レンダリング(数十秒で終わる)
 *   --no-voice 音声なしで尺推定レンダリング(VOICEVOX不要の見た目確認用)
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scriptSchema, slugify, type VoiceManifest } from "../src/schema";

const VIDEO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function main() {
  const args = process.argv.slice(2);
  const scriptPath = args.find((a) => !a.startsWith("--"));
  const draft = args.includes("--draft");
  const noVoice = args.includes("--no-voice");
  const outFlag = args.indexOf("--out");
  if (!scriptPath) {
    console.error("usage: pnpm render <script.json> [--draft] [--out <path>] [--no-voice]");
    process.exit(1);
  }

  const parsed = scriptSchema.safeParse(JSON.parse(readFileSync(scriptPath, "utf-8")));
  if (!parsed.success) {
    console.error("台本JSONがスキーマに合いません:");
    console.error(parsed.error.format());
    process.exit(1);
  }
  const script = parsed.data;
  const slug = script.meta.slug ?? slugify(script.meta.title);

  let voices: VoiceManifest | null = null;
  if (!noVoice) {
    const manifestPath = join(VIDEO_ROOT, "public", "voices", slug, "manifest.json");
    if (!existsSync(manifestPath)) {
      console.error(`音声が未生成です: ${manifestPath}`);
      console.error(`→ 先に: pnpm voice ${scriptPath}`);
      console.error("→ 音声なしで見た目だけ確認するなら --no-voice");
      process.exit(1);
    }
    voices = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (voices!.cuts.length !== script.cuts.length) {
      console.error(
        `manifestのカット数(${voices!.cuts.length})が台本(${script.cuts.length})と一致しません。`,
      );
      console.error(`→ 台本を変えたら: pnpm voice ${scriptPath} --force`);
      process.exit(1);
    }
  }

  if (script.meta.bgm) {
    const bgmPath = join(VIDEO_ROOT, "public", "bgm", script.meta.bgm);
    if (!existsSync(bgmPath)) {
      console.error(`BGMファイルがありません: ${bgmPath}`);
      console.error("→ public/bgm/ にファイルを置くか、meta.bgm を null にしてください。");
      process.exit(1);
    }
  }

  const cacheDir = join(VIDEO_ROOT, ".cache");
  mkdirSync(cacheDir, { recursive: true });
  const propsPath = join(cacheDir, `props-${slug}.json`);
  writeFileSync(propsPath, JSON.stringify({ script, voices }));

  const outPath =
    outFlag >= 0 ? args[outFlag + 1] : join(VIDEO_ROOT, "out", `${slug}${draft ? ".draft" : ""}.mp4`);

  const cliArgs = [
    "remotion", "render", "src/index.ts", "Main", outPath,
    `--props=${propsPath}`,
    ...(draft ? ["--scale=0.4", "--crf=32"] : []),
  ];
  console.log(`rendering → ${outPath}${draft ? " (draft)" : ""}`);
  const result = spawnSync("npx", cliArgs, { cwd: VIDEO_ROOT, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);

  console.log(`\n完成: ${outPath}`);
  if (draft) console.log(`本番レンダリング: pnpm render ${scriptPath}`);
}

main();
