import { describe, expect, test } from "bun:test";
import {
  judgeReplyLanguage,
  replyLanguageReason,
  replyLanguageRule,
} from "../../../src/domain/hooks/reply-language";

const japanese = () => {
  const rule = replyLanguageRule("Japanese");
  if (rule === undefined) throw new Error("Japanese must be supported");
  return rule;
};

describe("which settings are judged", () => {
  test("Japanese is supported however the setting spells it", () => {
    for (const value of ["Japanese", "japanese", " Japanese ", "ja", "日本語"]) {
      expect(replyLanguageRule(value)).toBeDefined();
    }
  });

  test("an absent, non-string or unsupported setting is not judged", () => {
    for (const value of [undefined, null, 1, "", "French"]) {
      expect(replyLanguageRule(value)).toBeUndefined();
    }
  });
});

describe("Japanese replies", () => {
  test("a Japanese reply full of product names and identifiers matches", () => {
    const reply =
      "Career タブを、All → Writing → Career → Code → Reading → Gear の並びで足しています。" +
      "`stopGate` は `harness/jig/src/cli/hooks/stop-gate.ts` にあり、bun test と Biome の lint は通りました。";
    expect(judgeReplyLanguage(reply, japanese())).toBe("matches");
  });

  test("code blocks, URLs and paths do not count against a Japanese reply", () => {
    const reply = [
      "設定を直しました。差分は次のとおりです。",
      "```ts",
      "export function judgeReplyLanguage(text: string, rule: LanguageRule): ReplyLanguageVerdict {",
      "  return text.length > 0 ? 'matches' : 'too-short';",
      "}",
      "```",
      "詳しくは https://code.claude.com/docs/en/hooks#stop-input と src/domain/hooks/reply-language.ts を見てください。",
    ].join("\n");
    expect(judgeReplyLanguage(reply, japanese())).toBe("matches");
  });

  test("a mostly English paragraph is off-language", () => {
    const reply =
      "The test review is in, with 7 findings. Before I verify them, I'm waiting for the other three reviews to finish.";
    expect(judgeReplyLanguage(reply, japanese())).toBe("off-language");
  });

  test("an English sentence quoting one Japanese label is still off-language", () => {
    const reply = 'Next, I\'m adding a visible "部屋に戻る" button to the game screen.';
    expect(judgeReplyLanguage(reply, japanese())).toBe("off-language");
  });

  test("a reply too short to judge is not judged, in either language", () => {
    expect(judgeReplyLanguage("Done.", japanese())).toBe("too-short");
    expect(judgeReplyLanguage("完了しました。", japanese())).toBe("too-short");
    expect(
      judgeReplyLanguage("```\nconst a = 'a long English line of code';\n```", japanese()),
    ).toBe("too-short");
  });
});

test("the reason names the expected language and quotes each passage, a long one cut short", () => {
  const long = `${"word ".repeat(60)}TAIL`;
  const reason = replyLanguageReason(japanese(), ["Now I'll run the tests.", long]);
  expect(reason).toContain("in Japanese");
  expect(reason).toContain(`1. "Now I'll run the tests."`);
  expect(reason).toContain('2. "word word');
  expect(reason).not.toContain("TAIL");
});

test("past ten passages the reason lists ten and counts the rest", () => {
  const passages = Array.from({ length: 133 }, (_, i) => `English passage number ${i + 1}.`);
  const reason = replyLanguageReason(japanese(), passages);
  expect(reason).toContain(`10. "English passage number 10."`);
  expect(reason).not.toContain("passage number 11.");
  expect(reason).toContain("123 more");
});
