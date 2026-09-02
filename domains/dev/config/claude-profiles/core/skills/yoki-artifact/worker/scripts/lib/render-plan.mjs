// render-plan.mjs — turn a plan into the text `--dry-run` prints.
//
// Every API call appears in full (method, path, body) so a dry run can be read
// as the review artefact it is meant to be. Values that only exist at run time
// print as `<step-id.field>`.

import { API_BASE } from "./constants.mjs";
import { isRef } from "./plan.mjs";

/** Replace refs with a readable placeholder so a body can be JSON-printed. */
export function describeValue(value) {
  if (isRef(value)) return `<${value.$ref}.${value.path}>`;
  if (Array.isArray(value)) return value.map(describeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, describeValue(item)]));
  }
  return value;
}

const indent = (text, prefix = "    ") =>
  text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");

export function renderStep(step, index) {
  const marker = step.skip ? "skip" : "do";
  const head = `${String(index + 1).padStart(2, " ")}. [${marker}] ${step.describe}${step.skip ? ` — ${step.skip}` : ""}`;
  if (step.skip) return head;
  const lines = [head];
  if (step.kind === "api") {
    lines.push(indent(`${step.method} ${API_BASE}${step.path}`));
    if (step.body) lines.push(indent(JSON.stringify(describeValue(step.body), null, 2)));
    if (step.fallback) {
      lines.push(indent(`on a rejected body (400/422): ${step.fallback.describe}`));
      lines.push(indent(JSON.stringify(describeValue(step.fallback.body), null, 2), "      "));
    }
  } else if (step.kind === "exec") {
    lines.push(indent(`$ ${step.command} ${step.args.join(" ")}`));
  } else if (step.kind === "file") {
    lines.push(indent(JSON.stringify(describeValue(step.values), null, 2)));
  }
  return lines.join("\n");
}

export function renderPlan(plan) {
  const header = `plan: ${plan.kind} — ${plan.steps.filter((s) => !s.skip).length} action(s), ${plan.steps.filter((s) => s.skip).length} skipped`;
  return [header, "", ...plan.steps.map(renderStep)].join("\n");
}
