# artifact-worker

The Cloudflare Worker behind `artifact` (formerly `yoki-artifact`): Workers +
R2 (page bodies) + D1 (channels, versions, comments) + Access (who may view).
It used to sit inside the skill as `skills/yoki-artifact/worker/`; it lives
here so the skill holds procedure only.

- Driven by the `artifact` skill
  (`$DOTFILES_ROOT/domains/dev/llm/harness/skills/artifact/`), whose CLI
  in `bin/` talks to the deployed Worker. The CLI finds this directory through
  `$DOTFILES_ROOT` (`doctor` prints the head of `SETUP.md` from here).
- Setup: read `SETUP.md` first (Zero Trust onboarding, IdP, R2 activation and
  the API token are manual), then `pnpm install` and
  `node scripts/setup.mjs` for everything that can be automated. wrangler is
  a project dependency — `pnpm exec wrangler ...`, never a global install.
- Tests: `pnpm test` (`node --test test/*.test.mjs`).
- `viewers.json` (real addresses) is git-ignored; `viewers.example.json` is
  the template.
