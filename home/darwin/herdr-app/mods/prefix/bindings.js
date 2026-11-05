// The keys after Ctrl+q, and how a key event becomes one of them. No app
// imports, so tests/repo/herdr-prefix.test.mjs can run this file outside Herdr.
export const PREFIX_LABEL = "Ctrl+q";

// [key, label, command, args, repeatable]. Splits and pane focus match the
// terminal herdr (home/shared/herdr/config/config.toml); e, g and f open a tab
// where it opens a popup, and its last-pane key has no command here.
export const BINDINGS = [
  ["\\", "Split right", "pane.split", { direction: "right" }],
  ["-", "Split down", "pane.split", { direction: "down" }],
  ["x", "Close pane", "pane.close"],
  ["c", "New tab", "tab.new"],
  ["z", "Zoom pane", "pane.zoom"],
  ["h", "Focus left", "pane.go", { direction: "left" }, true],
  ["j", "Focus down", "pane.go", { direction: "down" }, true],
  ["k", "Focus up", "pane.go", { direction: "up" }, true],
  ["l", "Focus right", "pane.go", { direction: "right" }, true],
  ["e", "nvim in a new tab", "terminal.open", { argv: ["nvim"] }],
  ["g", "lazygit in a new tab", "terminal.open", { argv: ["lazygit"] }],
  ["f", "yazi in a new tab", "terminal.open", { argv: ["yazi"] }],
];

// With a Japanese input source on, key_char can be kana or empty; e.key still
// names the physical key, so only an ASCII key_char is trusted.
export function resolveKey(e) {
  const m = e.modifiers;
  if (m.control || m.alt || m.platform) return null;
  const char = e.key_char;
  if (char && /^[\x20-\x7e]$/.test(char)) return char;
  return e.key.length === 1 ? e.key : null;
}

export const findBinding = (key) => BINDINGS.find((b) => b[0] === key);

// How `hc keys` names a typed key, null when it has no plain name: a key
// typed during the repeat window still reaches the terminal.
export function literalKey(key) {
  if (key === "\\") return "backslash";
  if (key === " ") return "space";
  if (/^[A-Z]$/.test(key)) return `shift+${key.toLowerCase()}`;
  return key && /^[a-z0-9`\[\],=\-.';/]$/.test(key) ? key : null;
}
