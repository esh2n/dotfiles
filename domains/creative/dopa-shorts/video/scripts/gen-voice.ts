/**
 * 台本JSON → セリフごとのwav + manifest.json
 *
 * 使い方:
 *   pnpm voice <script.json> [--force]
 *
 * 出力: public/voices/<slug>/{000.wav, 001.wav, ..., manifest.json}
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scriptSchema, slugify, type VoiceCutInfo, type VoiceManifest } from "../src/schema";
import { ADAPTERS } from "./lib/adapters";

const VIDEO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RETRIES = 2;

async function main() {
  const args = process.argv.slice(2);
  const scriptPath = args.find((a) => !a.startsWith("--"));
  const force = args.includes("--force");
  if (!scriptPath) {
    console.error("usage: pnpm voice <script.json> [--force]");
    process.exit(1);
  }

  const parsed = scriptSchema.safeParse(JSON.parse(readFileSync(scriptPath, "utf-8")));
  if (!parsed.success) {
    console.error("台本JSONがスキーマに合いません:");
    console.error(parsed.error.format());
    process.exit(1);
  }
  const script = parsed.data;
  const { meta } = script;
  const slug = meta.slug ?? slugify(meta.title);

  const adapter = ADAPTERS[meta.adapter];
  const availability = await adapter.available();
  if (availability !== true) {
    console.error(`[${adapter.name}] 利用できません:\n${availability}`);
    if (adapter.name !== "voicevox") {
      console.error('→ meta.adapter を "voicevox" にすればローカルで生成できます。');
    }
    process.exit(1);
  }

  const outDir = join(VIDEO_ROOT, "public", "voices", slug);
  const manifestPath = join(outDir, "manifest.json");
  if (existsSync(manifestPath) && !force) {
    console.log(`既に生成済みです: ${manifestPath} (作り直すには --force)`);
    return;
  }
  mkdirSync(outDir, { recursive: true });

  const cuts: VoiceCutInfo[] = [];
  for (const [i, cut] of script.cuts.entries()) {
    const speaker = cut.speaker ?? meta.voice;
    const fileName = `${String(i).padStart(3, "0")}.wav`;
    process.stdout.write(
      `[${i + 1}/${script.cuts.length}] ${speaker}: ${cut.text.slice(0, 24)}... `,
    );

    let lastError: unknown;
    let done = false;
    for (let attempt = 0; attempt <= RETRIES && !done; attempt++) {
      try {
        const result = await adapter.synthesize(cut.reading ?? cut.text, {
          speaker,
          speed: meta.speed,
        });
        writeFileSync(join(outDir, fileName), result.wav);
        cuts.push({
          file: `voices/${slug}/${fileName}`,
          durationSec: result.durationSec,
          speech: result.speech,
        });
        console.log(`${result.durationSec.toFixed(2)}s`);
        done = true;
      } catch (e) {
        lastError = e;
        if (attempt < RETRIES) process.stdout.write(`retry(${attempt + 1}) `);
      }
    }
    if (!done) {
      console.error(`\nカット${i}の音声生成に失敗しました:`, lastError);
      process.exit(1);
    }
  }

  const manifest: VoiceManifest = {
    adapter: meta.adapter,
    voice: meta.voice,
    speed: meta.speed,
    cuts,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const totalSec = cuts.reduce((s, c) => s + c.durationSec, 0);
  console.log(`\n完了: ${outDir} (音声計 ${totalSec.toFixed(1)}s / ${cuts.length}カット)`);
  console.log(`次: pnpm render ${scriptPath} --draft`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
