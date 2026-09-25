/**
 * `jig apply`'s use-case: read the canonical tiers.json, generate each
 * target's content, diff it against what's actually on disk, and — only
 * when asked, and never for litellm — write it atomically with hand-edit
 * detection and a provenance sidecar. Depends only on `ApplyPorts` and the
 * pure `domain/tiers/*` functions; no direct filesystem/crypto calls here
 * (those live in `../../infra/apply`).
 */

import type { DroppedField } from "../../domain/tiers/capability";
import { unifiedDiff } from "../../domain/tiers/diff";
import { TIERS_MANAGED_BLOCK_MARKERS } from "../../domain/tiers/markers";
import { parseTiers } from "../../domain/tiers/parse";
import { type PlanAction, planApply } from "../../domain/tiers/plan";
import { spliceManagedBlock } from "../../domain/tiers/splice";
import type { TiersPolicy } from "../../domain/tiers/types";
import { toDshModelsBlock } from "../../domain/tiers/write-dsh";
import { toLitellmModelList } from "../../domain/tiers/write-litellm";
import { toOmpProxyBlock } from "../../domain/tiers/write-omp";
import { toPiModels } from "../../domain/tiers/write-pi";
import type { ApplyPorts } from "./ports";

export type ApplyTarget = "pi" | "dsh" | "omp" | "litellm";
export const ALL_APPLY_TARGETS: readonly ApplyTarget[] = ["pi", "dsh", "omp", "litellm"];

export interface ApplyTargetPaths {
  readonly pi: string;
  readonly dsh: string;
  /** `domains/dev/config/omp/models.yml` — the `proxy:` block between the jig:tiers markers. */
  readonly omp: string;
  readonly litellm: string;
}

export interface ApplyOptions {
  readonly targets: readonly ApplyTarget[];
  readonly write: boolean;
}

export type TargetOutcome =
  | "write"
  | "noop"
  | "conflict"
  | "refused"
  | "markers-missing"
  | "dest-missing";

export interface TargetResult {
  readonly target: ApplyTarget;
  readonly outcome: TargetOutcome;
  readonly diff: string;
  readonly dropped: readonly DroppedField[];
  readonly wrote: boolean;
  readonly message?: string;
  /** Only set for litellm when markers aren't present yet: the block that WOULD be spliced in. */
  readonly preview?: string;
}

export interface ApplyReport {
  readonly results: readonly TargetResult[];
  readonly hasConflict: boolean;
}

async function readManifestHash(
  ports: ApplyPorts,
  manifest: Readonly<Record<string, string>>,
  destPath: string,
): Promise<string | undefined> {
  return manifest[destPath];
}

async function finishWrite(
  ports: ApplyPorts,
  destPath: string,
  content: string,
  tiersJsonPath: string,
  tiersJsonText: string,
  manifest: Record<string, string>,
): Promise<void> {
  await ports.writeAtomic(destPath, content);
  manifest[destPath] = ports.sha256(content);
  await ports.writeManifest(manifest);

  const destDir = destPath.slice(0, Math.max(destPath.lastIndexOf("/"), 0));
  await ports.writeProvenance(destDir, {
    sourceFile: tiersJsonPath,
    sourceSha256: ports.sha256(tiersJsonText),
    generatedAt: ports.now().toISOString(),
    jigVersion: ports.jigVersion,
  });
}

function outcomeFromPlan(action: PlanAction): TargetOutcome {
  return action;
}

/**
 * A "noop" plan means the file already reads exactly as generated — but if
 * the manifest doesn't yet record that (first apply ever for this dest, or a
 * hand edit that happened to land back on the generated text), `--write`
 * should still seed/heal the manifest so a LATER hand edit is correctly
 * detected as one. No file content changes here — only the out-of-repo
 * manifest — so this never shows up in `git diff`.
 */
async function syncManifestIfUnrecorded(
  ports: ApplyPorts,
  destPath: string,
  generatedContent: string,
  manifestHash: string | undefined,
  manifest: Record<string, string>,
): Promise<void> {
  const generatedHash = ports.sha256(generatedContent);
  if (manifestHash !== generatedHash) {
    manifest[destPath] = generatedHash;
    await ports.writeManifest(manifest);
  }
}

async function applyPi(
  policy: TiersPolicy,
  destPath: string,
  ports: ApplyPorts,
  manifest: Record<string, string>,
  write: boolean,
  tiersJsonPath: string,
  tiersJsonText: string,
): Promise<TargetResult> {
  const { content: generated, dropped } = toPiModels(policy);
  const current = await ports.readFile(destPath);
  const manifestHash = await readManifestHash(ports, manifest, destPath);
  const plan = planApply({
    currentContent: current,
    generatedContent: generated,
    manifestHash,
    sha256: ports.sha256,
  });

  const diff = unifiedDiff(destPath, current ?? "", "generated", generated);

  if (write && plan.action === "write") {
    await finishWrite(ports, destPath, generated, tiersJsonPath, tiersJsonText, manifest);
    return { target: "pi", outcome: "write", diff, dropped, wrote: true };
  }

  if (write && plan.action === "noop") {
    await syncManifestIfUnrecorded(ports, destPath, generated, manifestHash, manifest);
  }

  return {
    target: "pi",
    outcome: outcomeFromPlan(plan.action),
    diff,
    dropped,
    wrote: false,
    ...(plan.action === "conflict"
      ? {
          message:
            "hand-edit conflict: current file differs from both jig's last write and the newly generated content",
        }
      : {}),
  };
}

/**
 * dsh's settings.yaml and omp's models.yml take the same shape: one managed
 * YAML block between the shared markers, spliced into a file the owner also
 * edits by hand outside the markers.
 */
async function applyManagedYaml(
  target: "dsh" | "omp",
  block: string,
  dropped: readonly DroppedField[],
  destPath: string,
  ports: ApplyPorts,
  manifest: Record<string, string>,
  write: boolean,
  tiersJsonPath: string,
  tiersJsonText: string,
): Promise<TargetResult> {
  const current = await ports.readFile(destPath);

  if (current === undefined) {
    return {
      target,
      outcome: "dest-missing",
      diff: "",
      dropped,
      wrote: false,
      message: `${destPath} does not exist`,
    };
  }

  let generated: string;
  try {
    generated = spliceManagedBlock(current, block, TIERS_MANAGED_BLOCK_MARKERS);
  } catch (error) {
    return {
      target,
      outcome: "markers-missing",
      diff: "",
      dropped,
      wrote: false,
      message: error instanceof Error ? error.message : String(error),
      preview: block,
    };
  }

  const manifestHash = await readManifestHash(ports, manifest, destPath);
  const plan = planApply({
    currentContent: current,
    generatedContent: generated,
    manifestHash,
    sha256: ports.sha256,
  });

  const diff = unifiedDiff(destPath, current, "generated", generated);

  if (write && plan.action === "write") {
    await finishWrite(ports, destPath, generated, tiersJsonPath, tiersJsonText, manifest);
    return { target, outcome: "write", diff, dropped, wrote: true };
  }

  if (write && plan.action === "noop") {
    await syncManifestIfUnrecorded(ports, destPath, generated, manifestHash, manifest);
  }

  return {
    target,
    outcome: outcomeFromPlan(plan.action),
    diff,
    dropped,
    wrote: false,
    ...(plan.action === "conflict"
      ? {
          message:
            "hand-edit conflict: current file differs from both jig's last write and the newly generated content",
        }
      : {}),
  };
}

async function applyLitellm(
  policy: TiersPolicy,
  destPath: string,
  ports: ApplyPorts,
  write: boolean,
): Promise<TargetResult> {
  const { content: block, dropped } = toLitellmModelList(policy);
  const current = await ports.readFile(destPath);

  const refusalMessage = "deferred: measurement plane, apply manually after review";

  if (current === undefined) {
    return {
      target: "litellm",
      outcome: "dest-missing",
      diff: "",
      dropped,
      wrote: false,
      message: `${destPath} does not exist`,
    };
  }

  try {
    const generated = spliceManagedBlock(current, block, TIERS_MANAGED_BLOCK_MARKERS);
    const diff = unifiedDiff(destPath, current, "generated", generated);
    return {
      target: "litellm",
      outcome: write ? "refused" : diff === "" ? "noop" : "write",
      diff,
      dropped,
      wrote: false,
      message: refusalMessage,
    };
  } catch {
    // No managed-block markers in config.yaml yet (by design — never inserted
    // this phase). Show the generated block for review instead of a diff.
    return {
      target: "litellm",
      outcome: "markers-missing",
      diff: "",
      dropped,
      wrote: false,
      message: `${refusalMessage} (no # BEGIN jig:tiers markers in ${destPath} yet)`,
      preview: block,
    };
  }
}

export async function applyTiers(
  input: {
    readonly tiersJsonPath: string;
    readonly destPaths: ApplyTargetPaths;
    readonly options: ApplyOptions;
  },
  ports: ApplyPorts,
): Promise<ApplyReport> {
  const tiersJsonText = await ports.readFile(input.tiersJsonPath);
  if (tiersJsonText === undefined) {
    throw new Error(`jig apply: tiers.json not found at ${input.tiersJsonPath}`);
  }
  const policy = parseTiers(JSON.parse(tiersJsonText));

  const manifest = { ...(await ports.readManifest()) };
  const results: TargetResult[] = [];

  for (const target of ALL_APPLY_TARGETS) {
    if (!input.options.targets.includes(target)) continue;

    if (target === "pi") {
      results.push(
        await applyPi(
          policy,
          input.destPaths.pi,
          ports,
          manifest,
          input.options.write,
          input.tiersJsonPath,
          tiersJsonText,
        ),
      );
    } else if (target === "dsh" || target === "omp") {
      const { content, dropped } =
        target === "dsh" ? toDshModelsBlock(policy) : toOmpProxyBlock(policy);
      results.push(
        await applyManagedYaml(
          target,
          content,
          dropped,
          input.destPaths[target],
          ports,
          manifest,
          input.options.write,
          input.tiersJsonPath,
          tiersJsonText,
        ),
      );
    } else {
      results.push(await applyLitellm(policy, input.destPaths.litellm, ports, input.options.write));
    }
  }

  return { results, hasConflict: results.some((r) => r.outcome === "conflict") };
}
