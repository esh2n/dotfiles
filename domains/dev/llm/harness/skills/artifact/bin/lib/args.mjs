// args.mjs — argv into a frozen { command, positionals, flags }.
//
// Unknown flags are a hard usage error rather than something ignored: a typo'd
// `--allow-externals` must not silently become a refusal the caller cannot
// explain. `--` ends flag parsing.

import { usageError } from "./errors.mjs";

/** Every flag the CLI accepts, and what shape its value takes. */
export const FLAG_TYPES = Object.freeze({
  channel: "string",
  title: "string",
  label: "string",
  note: "string",
  since: "string",
  to: "list",
  interval: "number",
  json: "boolean",
  open: "boolean",
  once: "boolean",
  help: "boolean",
  "to-agent": "boolean",
  "allow-external": "boolean",
});

const EMPTY_FLAGS = Object.freeze({ to: Object.freeze([]) });

function withFlag(flags, name, value) {
  if (FLAG_TYPES[name] === "list") {
    return Object.freeze({ ...flags, [name]: Object.freeze([...(flags[name] ?? []), value]) });
  }
  return Object.freeze({ ...flags, [name]: value });
}

function parseNumber(name, raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw usageError("bad_flag_value", `--${name} needs a positive number (got "${raw}").`);
  }
  return value;
}

export function parseArgs(argv) {
  let flags = EMPTY_FLAGS;
  const positionals = [];
  let literal = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (literal || !arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
      continue;
    }
    if (arg === "--") {
      literal = true;
      continue;
    }
    if (arg === "-h") {
      flags = withFlag(flags, "help", true);
      continue;
    }
    if (!arg.startsWith("--")) {
      throw usageError("unknown_flag", `Unknown option "${arg}".`);
    }

    const eq = arg.indexOf("=");
    const name = (eq === -1 ? arg.slice(2) : arg.slice(2, eq)).trim();
    const type = FLAG_TYPES[name];
    if (type === undefined) {
      throw usageError("unknown_flag", `Unknown option "--${name}".`);
    }
    if (type === "boolean") {
      if (eq !== -1) throw usageError("bad_flag_value", `--${name} does not take a value.`);
      flags = withFlag(flags, name, true);
      continue;
    }
    const raw = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (raw === undefined || (eq === -1 && raw.startsWith("--"))) {
      throw usageError("missing_flag_value", `--${name} needs a value.`);
    }
    flags = withFlag(flags, name, type === "number" ? parseNumber(name, raw) : raw);
  }

  const [command = null, ...rest] = positionals;
  return Object.freeze({ command, positionals: Object.freeze(rest), flags });
}
