/**
 * How a model opens a skill, per harness — one sentence, no trailing punctuation.
 *
 * It lives on its own because two things say it now: the router's reminder (which names the
 * picks and then points at their bodies) and the fallback catalog (which names everything
 * relevant and points at nothing). If those two drifted apart, a turn in the experiment's
 * arm B' would be told to open a skill one way when the router had an opinion and another
 * way when it did not — a difference in the instruction, measured as a difference in the
 * model's behaviour.
 *
 * A harness that has not said who it is gets the path-only wording: naming a tool that does
 * not exist there is worse than naming none. See `cli/hooks/user-prompt-submit.ts` for the
 * measurement that put `Skill(<name>)` in the claude wording.
 */
export function invocation(harness: string): string {
  if (harness === "claude") {
    return "Invoke each with the Skill tool — `Skill(<name>)`, or `/<name>`";
  }
  return "Read and follow these before doing the work";
}
