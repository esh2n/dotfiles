/**
 * Template substitution — pure. Replace `{{VAR}}` placeholders in every string
 * of a Json value (recursing through objects and arrays). Known variables are
 * substituted; unknown placeholders are left untouched so a typo fails loudly
 * downstream rather than silently becoming an empty string.
 */

import type { Json } from "./merge";

export type TemplateVars = Readonly<Record<string, string>>;

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/** The same substitution over one string, for callers that hold typed records rather than Json. */
export function templateString(value: string, vars: TemplateVars): string {
  return value.replace(PLACEHOLDER, (match, name: string) => vars[name] ?? match);
}

export function applyTemplate(value: Json, vars: TemplateVars): Json {
  if (typeof value === "string") return templateString(value, vars);
  if (Array.isArray(value)) return value.map((item) => applyTemplate(item, vars));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, Json> = {};
    for (const [key, item] of Object.entries(value)) out[key] = applyTemplate(item, vars);
    return out;
  }
  return value;
}
