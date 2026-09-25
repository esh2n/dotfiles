/**
 * Use-case: register (or re-register) jig's guard with codex. Reads both
 * codex files, plans the edits with the pure functions in
 * `domain/codex/register`, and writes them only when asked. Refuses to
 * write a trust entry whose key some other tool already declares outside
 * jig's block: a duplicate table would stop codex from loading its config
 * at all, which is worse than a hook that does not run.
 */

import {
  PRE_TOOL_USE_LABEL,
  type RegistrationInput,
  keyDeclaredElsewhere,
  planRegistration,
  planTrust,
  trustKey,
  trustTable,
} from "../../domain/codex/register";
import type { ApplyPorts } from "../apply/ports";

export interface CodexPaths {
  readonly hooksJson: string;
  readonly configToml: string;
}

export interface CodexRegisterOptions {
  readonly write: boolean;
  /** Called with the config text before writing; throw to refuse. */
  readonly validateToml?: (text: string) => void;
}

export interface CodexRegisterResult {
  readonly key: string;
  readonly hash: string;
  readonly hooksJsonChanged: boolean;
  readonly configTomlChanged: boolean;
  readonly written: boolean;
  readonly hooksJson: string;
  readonly configToml: string;
}

export async function registerCodex(
  ports: Pick<ApplyPorts, "readFile" | "writeAtomic" | "sha256">,
  paths: CodexPaths,
  input: RegistrationInput,
  options: CodexRegisterOptions,
): Promise<CodexRegisterResult> {
  const [hooksBefore, configBefore] = await Promise.all([
    ports.readFile(paths.hooksJson),
    ports.readFile(paths.configToml),
  ]);

  const registration = planRegistration(hooksBefore, input);
  const key = trustKey(
    paths.hooksJson,
    PRE_TOOL_USE_LABEL,
    registration.groupIndex,
    registration.handlerIndex,
  );
  const hash = ports.sha256(registration.canonicalIdentity);
  if (configBefore !== undefined && keyDeclaredElsewhere(configBefore, key)) {
    throw new Error(
      `config.toml already declares [hooks.state."${key}"] outside jig's block; another tool owns that slot — resolve by hand before registering`,
    );
  }
  const trust = planTrust(configBefore, [trustTable(key, hash)]);
  options.validateToml?.(trust.configToml);

  let written = false;
  if (options.write && (registration.hooksJsonChanged || trust.changed)) {
    if (registration.hooksJsonChanged) {
      await ports.writeAtomic(paths.hooksJson, registration.hooksJson);
    }
    if (trust.changed) await ports.writeAtomic(paths.configToml, trust.configToml);
    written = true;
  }

  return {
    key,
    hash,
    hooksJsonChanged: registration.hooksJsonChanged,
    configTomlChanged: trust.changed,
    written,
    hooksJson: registration.hooksJson,
    configToml: trust.configToml,
  };
}
