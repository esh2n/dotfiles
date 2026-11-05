// Ctrl+q, then a key, as in the terminal herdr. Written from the brief in
// herdrdev/herdr-layout-examples, tmux-prefix/RECIPE.md (Apache-2.0).
// It runs `hc keys` to pass a literal Ctrl+q to the focused terminal.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { closeOverlay, focused, hc, nextCommand, props, run, theme } from "herdr";
import { BINDINGS, PREFIX_LABEL, findBinding, literalKey, resolveKey } from "./bindings.js";

const REPEAT_MS = 500;

export default class Prefix extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.repeating = false;
    this.generation = 0;
    // keys.json's mod:prefix section sends Ctrl+q here while the popup is open.
    cx.spawn(async (cx) => {
      for (;;) {
        await nextCommand();
        this.sendLiteral(cx);
      }
    });
  }

  dismiss() {
    closeOverlay(props().overlay);
  }

  sendLiteral(cx, key = "ctrl+q") {
    const terminal = focused()?.terminal;
    if (terminal) {
      const pending = hc(["keys", terminal, key]);
      cx.spawn(async () => {
        const result = await pending;
        if (result.code !== 0) console.log(`prefix: ${result.stderr}`);
      });
    }
    this.dismiss();
  }

  keepOpen(cx) {
    this.repeating = true;
    const generation = ++this.generation;
    cx.timer.after(REPEAT_MS, () => {
      if (this.generation === generation) this.dismiss();
    });
    cx.notify();
  }

  key(e, cx) {
    cx.stop_propagation();
    if (e.key === "escape") return this.dismiss();
    const typed = resolveKey(e);
    const binding = findBinding(typed);
    if (!binding) {
      const literal = this.repeating && typed ? literalKey(typed) : null;
      return literal ? this.sendLiteral(cx, literal) : this.dismiss();
    }
    const [, , command, args = {}, repeatable = false] = binding;
    if (!repeatable) this.dismiss();
    run(command, args);
    if (repeatable) this.keepOpen(cx);
  }

  render() {
    const t = theme();
    const title = this.repeating ? `Repeat · ${REPEAT_MS} ms` : `${PREFIX_LABEL} · waiting for a key`;
    return v_flex().id("prefix").track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .p(14).gap(8).bg(t.popover).text_color(t.foreground).text_size(12)
      .child(h_flex().justify_between().child(div().font_semibold().child(title))
        .child(div().text_color(t.muted).child("Esc cancel")))
      .child(v_flex().children(BINDINGS.map(([key, label, , , repeatable]) =>
        h_flex().h(20).flex_none().items_center().gap(12)
          .child(div().w(32).text_color(t.accent).child(key))
          .child(div().flex_1().child(label))
          .child(div().text_color(t.dim).child(repeatable ? "repeat" : "")))));
  }
}
