#!/usr/bin/env node
/**
 * Shared hook enable/disable controls.
 *
 * Controls (project config wins over env):
 * - <project>/.yoki.json  { "hookProfile": "...", "disabledHooks": [...] }
 *   (searched from cwd upward; malformed/missing file falls back to env)
 * - YOKI_HOOK_PROFILE=minimal|standard|strict (default: standard)
 * - YOKI_DISABLED_HOOKS=comma,separated,hook,ids
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VALID_PROFILES = new Set(['minimal', 'standard', 'strict']);

let projectConfigCache;

function getProjectConfig() {
  if (projectConfigCache !== undefined) return projectConfigCache;
  projectConfigCache = {};
  try {
    let dir = process.cwd();
    for (let i = 0; i < 20; i++) {
      const candidate = path.join(dir, '.yoki.json');
      if (fs.existsSync(candidate)) {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (parsed && typeof parsed === 'object') projectConfigCache = parsed;
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    projectConfigCache = {}; // fail-safe: a broken .yoki.json must never kill hooks
  }
  return projectConfigCache;
}

function normalizeId(value) {
  return String(value || '').trim().toLowerCase();
}

function getHookProfile() {
  const project = String(getProjectConfig().hookProfile || '').trim().toLowerCase();
  if (VALID_PROFILES.has(project)) return project;
  const raw = String(process.env.YOKI_HOOK_PROFILE || 'standard').trim().toLowerCase();
  return VALID_PROFILES.has(raw) ? raw : 'standard';
}

function getDisabledHookIds() {
  const project = getProjectConfig().disabledHooks;
  const fromProject = Array.isArray(project)
    ? project
    : String(project || '').split(',');
  const fromEnv = String(process.env.YOKI_DISABLED_HOOKS || '').split(',');

  return new Set(
    [...fromProject, ...fromEnv]
      .map(v => normalizeId(v))
      .filter(Boolean)
  );
}

function parseProfiles(rawProfiles, fallback = ['standard', 'strict']) {
  if (!rawProfiles) return [...fallback];

  if (Array.isArray(rawProfiles)) {
    const parsed = rawProfiles
      .map(v => String(v || '').trim().toLowerCase())
      .filter(v => VALID_PROFILES.has(v));
    return parsed.length > 0 ? parsed : [...fallback];
  }

  const parsed = String(rawProfiles)
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(v => VALID_PROFILES.has(v));

  return parsed.length > 0 ? parsed : [...fallback];
}

function isDryRun() {
  return process.env.YOKI_DRY_RUN === '1';
}

function isHookEnabled(hookId, options = {}) {
  const id = normalizeId(hookId);
  if (!id) return true;

  const disabled = getDisabledHookIds();
  if (disabled.has(id)) {
    return false;
  }

  const profile = getHookProfile();
  const allowedProfiles = parseProfiles(options.profiles);
  return allowedProfiles.includes(profile);
}

module.exports = {
  VALID_PROFILES,
  normalizeId,
  getHookProfile,
  getDisabledHookIds,
  parseProfiles,
  isHookEnabled,
  isDryRun,
};
