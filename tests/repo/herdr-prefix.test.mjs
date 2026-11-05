import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BINDINGS, findBinding, literalKey, resolveKey } from "../../home/darwin/herdr-app/mods/prefix/bindings.js";

const plain = { control: false, alt: false, platform: false };
const event = (key, key_char, modifiers = plain) => ({ key, key_char, modifiers });

describe("resolveKey", () => {
  test("a typed ASCII character wins, so a shifted key reads as what it types", () => {
    assert.equal(resolveKey(event("5", "%")), "%");
  });

  test("every binding is reached while a Japanese input source types something else", () => {
    for (const binding of BINDINGS) {
      for (const char of ["あ", "ー", "¥", undefined]) {
        assert.equal(findBinding(resolveKey(event(binding[0], char))), binding);
      }
    }
  });

  test("a key held with a modifier is not a binding", () => {
    for (const modifier of ["control", "alt", "platform"]) {
      assert.equal(resolveKey(event("h", "h", { ...plain, [modifier]: true })), null);
    }
  });

  test("a named key such as enter is not a binding", () => {
    assert.equal(resolveKey(event("enter", undefined)), null);
  });
});

describe("literalKey", () => {
  test("names a typed key the way hc keys expects", () => {
    assert.equal(literalKey("s"), "s");
    assert.equal(literalKey("S"), "shift+s");
    assert.equal(literalKey("\\"), "backslash");
    assert.equal(literalKey(" "), "space");
  });

  test("a key with no plain name is not sent", () => {
    assert.equal(literalKey("!"), null);
    assert.equal(literalKey("あ"), null);
  });
});

describe("bindings", () => {
  test("no key is bound twice", () => {
    const keys = BINDINGS.map((b) => b[0]);
    assert.equal(new Set(keys).size, keys.length);
  });

  test("the terminal herdr's splits keep their keys", () => {
    assert.deepEqual(findBinding("\\").slice(2, 4), ["pane.split", { direction: "right" }]);
    assert.deepEqual(findBinding("-").slice(2, 4), ["pane.split", { direction: "down" }]);
  });

  test("an unbound key finds nothing", () => {
    assert.equal(findBinding("q"), undefined);
  });
});
