/**
 * Types for the canonical model-tier table —
 * `domains/dev/llm/harness/policy/tiers.json`, the single source pi's
 * `models.json`, dsh's `settings.yaml` local-proxy provider, and litellm's
 * `config.yaml` model_list are all generated from (see `../../app/apply` and
 * `./write-*`).
 *
 * The schema deliberately holds the UNION of everything any one consumer
 * needs (an "upper vocabulary"): a field a given target format cannot
 * express (dsh has no `contextWindow`, litellm has no `compat`, pi has no
 * `reasoningEfforts`, …) is simply not read by that target's writer, which
 * reports the omission in its capability report (`./capability.ts`) rather
 * than silently dropping it with no trace.
 *
 * `_comment` fields carry human "why" context for a maintainer reading
 * `tiers.json` (and, where a writer chooses to, for a reader of the
 * generated file too) — they are never required and a writer is free to
 * ignore them.
 */

export const TIER_IDS = ["main", "complex", "deterministic"] as const;
export type TierId = (typeof TIER_IDS)[number];

/** Where a tier's requests actually go once they leave the proxy. Consumed by the litellm writer. */
export interface TierBackend {
  readonly provider: string;
  readonly model: string;
  /** Env var the litellm proxy reads the real provider key from. Absent for keyless backends (local LM Studio). */
  readonly apiKeyEnv?: string;
}

export interface TierCompat {
  readonly thinkingFormat?: string;
  readonly supportsReasoningEffort?: boolean;
}

/** `off` may map to `null` (send nothing) — pi's thinkingLevelMap and dsh's reasoningEfforts both use this shape. */
export type EffortMap = Readonly<Record<string, string | null>>;

export interface TierSamplingParams {
  readonly temperature: number;
  readonly top_p: number;
  readonly top_k: number;
}

export interface TierPiView {
  readonly name: string;
}

export interface TierDshView {
  readonly name: string;
  readonly reasoningEfforts?: EffortMap;
  /**
   * dsh's OWN compat block — deliberately separate from the shared `compat`
   * field below. In the real file only `main` carries `compat.thinkingFormat`
   * (it is the one tier where "off" needs to actually stop thinking); complex
   * and deterministic don't, even though pi's `compat.thinkingFormat` is set
   * for all three. That's a real, pre-existing asymmetry between the two
   * consumers, not a formatting difference, so it is modeled as dsh's own
   * fact rather than derived from `compat`.
   */
  readonly compat?: { readonly thinkingFormat?: string };
  readonly _comment?: Readonly<Record<string, string>>;
}

export interface Tier {
  /** The proxy's `model_name` / litellm alias — identical across every target by construction. */
  readonly alias: string;
  readonly displayName: string;
  readonly backend: TierBackend;
  readonly reasoning: boolean;
  readonly input: readonly string[];
  /** The harness's context BUDGET (compaction trigger, status %), not the provider's limit — rules/decisions/2026-09-24-context-window-budget-200k-extended-1m.md. */
  readonly contextWindow: number;
  /** The provider's larger window a harness may opt into explicitly (omp `/extended-context on`); absent = no extended window. */
  readonly maxContextWindow?: number;
  readonly maxTokens: number;
  readonly compat: TierCompat;
  /** pi only; deterministic-tier-only in practice, but not schema-enforced. */
  readonly thinkingLevelMap?: EffortMap;
  /** pi only; deterministic-tier-only in practice, but not schema-enforced. */
  readonly samplingParams?: TierSamplingParams;
  readonly pi: TierPiView;
  readonly dsh: TierDshView;
}

export interface ProxyConnectionCompat {
  readonly supportsDeveloperRole: boolean;
  readonly maxTokensField: string;
}

export interface ProxyConnection {
  readonly baseUrl: string;
  readonly api: string;
  readonly compat: ProxyConnectionCompat;
  readonly _comment?: Readonly<Record<string, string>>;
  readonly pi: { readonly apiKey: string };
  readonly dsh: {
    readonly displayName: string;
    readonly apiKeyEnv: string;
    readonly _comment?: Readonly<Record<string, string>>;
  };
}

export interface Connections {
  readonly proxy: ProxyConnection;
}

/** The parsed, strictly-validated `tiers.json` document. */
export interface TiersPolicy {
  readonly version: 1;
  readonly connections: Connections;
  readonly tiers: Readonly<Record<TierId, Tier>>;
}
