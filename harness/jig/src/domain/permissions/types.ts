/**
 * Types for the `permissions.yaml` sidecar — the source of truth for
 * `permissions.allow` / `permissions.deny` / `permissions.defaultMode` in
 * Claude's settings.json, compiled from core/personal/pack layers instead of
 * being read from the settings JSON layers themselves.
 *
 * Mirrors yoki's `runtime/yoki/scripts/lib/permissions/parse.js`.
 */

export interface PermissionEntry {
  readonly pattern: string;
  readonly reason?: string;
  readonly enforce?: readonly string[];
}

export interface GuardFloorEntry {
  readonly hook: string;
  readonly event?: string;
  readonly matcher?: string;
  readonly reason?: string;
}

/** One parsed `permissions.yaml` layer (core, a pack, or personal). */
export interface PermissionLayer {
  readonly allow: readonly PermissionEntry[];
  readonly deny: readonly PermissionEntry[];
  readonly guardFloor: readonly GuardFloorEntry[];
  readonly defaultMode?: string | undefined;
}

/** The result of merging layers in priority order (core -> packs -> personal). */
export interface MergedPermissions {
  readonly allow: readonly PermissionEntry[];
  readonly deny: readonly PermissionEntry[];
  readonly guardFloor: readonly GuardFloorEntry[];
  readonly defaultMode: string;
}
