#!/usr/bin/env node
// trigger-eval.mjs — evaluates whether a skill's frontmatter `description`
// alone triggers correctly on a set of labeled example inputs. Zero-dep
// Node (no npm packages). Does NOT call any LLM itself — it prepares a
// judging prompt (`prepare`) and scores a judge's answers (`score`).
//
// See ../references/trigger-eval.md for the full workflow (subagent as
// judge, train/holdout loop).

import fs from "node:fs";
import path from "node:path";

function usage() {
  return [
    "使い方:",
    "  node trigger-eval.mjs prepare <skill-dir> [--out prompt.md]",
    "  node trigger-eval.mjs score <skill-dir> <answers.json>",
    "",
    "<skill-dir>/evals/trigger-cases.json の形式:",
    '  {"cases":[{"input":"...","expect":true|false,"note":"..."}]}',
    "",
    "prepare は SKILL.md の frontmatter description のみを読み、判定用",
    "プロンプトを書き出す。score は judge の答え(JSON)を採点する。",
  ].join("\n");
}

function readDescription(skillDir) {
  const skillMdPath = path.join(skillDir, "SKILL.md");
  const text = fs.readFileSync(skillMdPath, "utf-8");
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== "---") {
    throw new Error(`${skillMdPath}: frontmatter が見つかりません（先頭が --- ではない）`);
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error(`${skillMdPath}: frontmatter の閉じ --- が見つかりません`);

  const front = lines.slice(1, end);
  let descLines = null;
  for (let i = 0; i < front.length; i++) {
    const m = front[i].match(/^description:\s*(.*)$/);
    if (m) {
      descLines = [m[1]];
      // Plain YAML scalars can continue on following indented lines that
      // don't start a new top-level key. Collect those too.
      for (let j = i + 1; j < front.length; j++) {
        if (/^[A-Za-z_][\w-]*:/.test(front[j])) break;
        if (front[j].trim() === "") break;
        descLines.push(front[j].trim());
      }
      break;
    }
  }
  if (descLines === null) {
    throw new Error(`${skillMdPath}: frontmatter に description フィールドが見つかりません`);
  }
  let desc = descLines.join(" ").trim();
  // Strip a single layer of surrounding quotes if present.
  if ((desc.startsWith('"') && desc.endsWith('"')) || (desc.startsWith("'") && desc.endsWith("'"))) {
    desc = desc.slice(1, -1);
  }
  return desc;
}

function readCases(skillDir) {
  const casesPath = path.join(skillDir, "evals", "trigger-cases.json");
  if (!fs.existsSync(casesPath)) {
    throw new Error(`${casesPath} が見つかりません`);
  }
  const data = JSON.parse(fs.readFileSync(casesPath, "utf-8"));
  if (!data || !Array.isArray(data.cases)) {
    throw new Error(`${casesPath}: {"cases":[...]} 形式ではありません`);
  }
  for (const [i, c] of data.cases.entries()) {
    if (typeof c.input !== "string" || typeof c.expect !== "boolean") {
      throw new Error(`${casesPath}: cases[${i}] は {input: string, expect: boolean, note?: string} が必要です`);
    }
  }
  return data.cases;
}

function buildPrompt(description, cases) {
  const numbered = cases.map((c, i) => `${i + 1}. ${c.input}`).join("\n");
  return [
    "以下はあるツール（skill）の起動条件を説明した description です。",
    "この description だけを根拠に、番号付きの各ユーザー発言に対して",
    "「このツールが起動すべきか（fire）／起動すべきでないか（skip）」を判定してください。",
    "本文や実装は見ないでください。description に書かれた条件だけで判断します。",
    "",
    "=== description ===",
    description,
    "=== description ここまで ===",
    "",
    "=== 判定対象の入力 ===",
    numbered,
    "=== 入力ここまで ===",
    "",
    `answers 配列は入力の数（${cases.length}件）と同じ長さ、同じ順序にしてください。`,
    "true = fire（起動すべき）, false = skip（起動すべきでない）。",
    "",
    "回答は次の JSON 以外、何も出力しないでください（説明・前置き・コードフェンス禁止）:",
    '{"answers": [true, false, ...]}',
  ].join("\n");
}

function cmdPrepare(args) {
  const skillDir = args[0];
  if (!skillDir) throw new Error("skill-dir を指定してください");
  let out = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--out") out = args[++i];
  }
  const description = readDescription(skillDir);
  const cases = readCases(skillDir);
  const prompt = buildPrompt(description, cases);
  if (out) {
    fs.writeFileSync(out, prompt, "utf-8");
    console.error(`書き出しました: ${out} (${cases.length} 件)`);
  } else {
    process.stdout.write(prompt + "\n");
  }
  return 0;
}

function cmdScore(args) {
  const skillDir = args[0];
  const answersPath = args[1];
  if (!skillDir || !answersPath) throw new Error("skill-dir と answers.json を指定してください");
  const cases = readCases(skillDir);
  const answersRaw = JSON.parse(fs.readFileSync(answersPath, "utf-8"));
  const answers = Array.isArray(answersRaw) ? answersRaw : answersRaw.answers;
  if (!Array.isArray(answers)) {
    throw new Error(`${answersPath}: {"answers":[true,false,...]} 形式ではありません`);
  }
  if (answers.length !== cases.length) {
    throw new Error(
      `件数不一致: cases=${cases.length} answers=${answers.length}`
    );
  }

  let tp = 0, fp = 0, fn = 0, tn = 0;
  const misses = [];
  cases.forEach((c, i) => {
    const judged = !!answers[i];
    const expect = c.expect;
    if (expect && judged) tp++;
    else if (!expect && judged) fp++;
    else if (expect && !judged) fn++;
    else tn++;
    if (judged !== expect) {
      misses.push({
        input: c.input,
        expect,
        judged,
        note: c.note ?? null,
        kind: expect ? "FN(見逃し: fire すべきなのに skip)" : "FP(誤爆: skip すべきなのに fire)",
      });
    }
  });

  const total = cases.length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const accuracy = (tp + tn) / total;

  const result = {
    total,
    tp,
    fp,
    fn,
    tn,
    precision,
    recall,
    accuracy,
    misses,
  };

  console.log(JSON.stringify(result, null, 2));
  console.error("");
  console.error(`accuracy=${accuracy.toFixed(3)} precision=${precision === null ? "n/a" : precision.toFixed(3)} recall=${recall === null ? "n/a" : recall.toFixed(3)}`);
  if (misses.length) {
    console.error(`misses (${misses.length}):`);
    for (const m of misses) {
      console.error(`  - [${m.kind}] "${m.input}" (expect=${m.expect}, note=${m.note ?? "-"})`);
    }
  }

  return accuracy < 0.9 ? 1 : 0;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "prepare") return cmdPrepare(rest);
    if (cmd === "score") return cmdScore(rest);
    console.error(usage());
    return cmd ? 1 : 0;
  } catch (err) {
    console.error(`エラー: ${err.message}`);
    return 1;
  }
}

process.exit(main());
