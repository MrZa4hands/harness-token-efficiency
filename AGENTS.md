# AGENTS.md

## Scope

These instructions apply to the entire `codex-token-efficiency/` subtree. Read this file, [README.md](README.md), and the [specification](docs/codex-token-efficiency-spec.md) before planning or implementation.

Keep all implementation source, tests, configuration templates, specifications, plans, review reports, and release documentation inside this subtree. Do not place implementation source in `agent-scripts` or the LifeOS payload. Native client registration, credentials, and runtime state use their required installation locations; they are not additional source or documentation copies.

Use English for filenames, identifiers, configuration keys, and code comments. Documentation prose must be in English. Keep files below approximately 500 lines. Use the project's runtime and existing dependencies; prefer the standard library. Prefix shell commands with `rtk`; use `rtk proxy` when exact evidence is required.

## Reference Code and Working Directory

This directory is an independent Git repository, initialized at Roe's request on 2026-10-01. The former parent repository's `.git` was moved to Trash; its source files remain available as reference material through these paths from the primary checkout:

| Reference     | Path from the module directory     |
| ------------- | ---------------------------------- |
| LifeOS source | `../LifeOS/`                       |
| Hooks         | `../LifeOS/install/hooks/`         |
| Runtime tools | `../LifeOS/install/LIFEOS/TOOLS/`  |
| Installer     | `../LifeOS/Tools/InstallEngine.ts` |

Read this code for research and inspiration; keep implementation changes inside this module. The [research document](docs/codex-token-efficiency-proposal.md) links to the specific reference files already analyzed.

Resolve the repository root with `rtk proxy git rev-parse --show-toplevel` before repository-level Git operations. Source, test, and documentation paths are relative to this repository root. The plan location is `docs/plans/`; do not create a nested `codex-token-efficiency/` directory. In implementation worktrees, locate the primary checkout through the parent directory of `rtk proxy git rev-parse --path-format=absolute --git-common-dir` before resolving the sibling reference paths above.

## Required Skills

Use the exact skills below at their specified workflow stages. Read the relevant `SKILL.md` before invoking it; do not execute a future stage merely because its skill is listed here.

| Stage                               | Required skill                         | Skill file                                                                                                            |
| ----------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Every implementation plan           | `$superpowers:writing-plans`           | [SKILL.md](/Users/mrz/.codex/plugins/cache/superpowers-dev/superpowers/6.4.2/skills/writing-plans/SKILL.md)           |
| Implementation and behavioral fixes | `$superpowers:test-driven-development` | [SKILL.md](/Users/mrz/.codex/plugins/cache/superpowers-dev/superpowers/6.4.2/skills/test-driven-development/SKILL.md) |
| First PR review                     | `$review`                              | [SKILL.md](/Users/mrz/Documents/keldai/tools/gstack/.agents/skills/gstack-review/SKILL.md)                            |
| Second PR review                    | `$superpowers:requesting-code-review`  | [SKILL.md](/Users/mrz/.codex/plugins/cache/superpowers-dev/superpowers/6.4.2/skills/requesting-code-review/SKILL.md)  |
| Documentation after both reviews    | `$document-release`                    | [SKILL.md](/Users/mrz/Documents/keldai/tools/gstack/.agents/skills/gstack-document-release/SKILL.md)                  |

If a skill path becomes stale, locate that same skill before proceeding. Do not silently substitute a different `review` skill.

## Implementation Plans

Every implementation plan must use `$superpowers:writing-plans`. Save plans under `docs/plans/`; the user-selected location overrides the skill's default.

Every plan must explicitly include:

1. A new feature branch and a new worktree created from the verified, up-to-date `develop` branch before any implementation.
2. Steps to verify and record the starting `develop` SHA, worktree location, feature branch, and PR base `develop` before implementation.
3. `$superpowers:test-driven-development` and a failing-test-first cycle for each behavior change.
4. The complete PR, review, documentation, merge, and cleanup sequence below, in that order.

Use `superpowers:using-git-worktrees` when creating the implementation worktree, as required by the planning skill. Do not implement directly on `main`, `develop`, or in the original checkout. If `develop` does not exist, report the missing prerequisite before implementation; never substitute `main` or invent a base branch.

Present the written plan for review before implementation. Preserve the user's selected execution method and the review limit below; do not add an independent final review through another execution or shipping skill.

## Implementation and PR Lifecycle

Follow this order for each implementation PR:

1. **Implement in the new worktree.** Use `$superpowers:test-driven-development`: write a meaningful failing test, observe its expected failure, write the minimum implementation, verify green, then refactor with tests green. Apply the same cycle to behavioral fixes from reviews. Run the project suite and required checks before declaring implementation complete; report failures explicitly.
2. **Create the PR.** Commit and push the feature branch, then create a PR targeting `develop`. Include scope, the phase plan, validation, and material limitations. Do not target the repository's default branch when it differs from `develop`.
3. **First review: `$review`.** Review that PR against `develop` and resolve all findings before proceeding. Retain the skill's internal fix verification within this stage. Commit and push its corrections to the same PR after the skill returns.
4. **Second review: `$superpowers:requesting-code-review`.** Dispatch the fresh reviewer with the plan, requirements, and actual PR range: merge-base against `develop` through the current PR head, not just the last commit. Fix all confirmed findings, including minor ones, and verify the corrections with tests. Commit and push to the same PR.
5. **Stop review passes.** After the second stage and its corrections, do not invoke either reviewer again or start another independent code, PR, or documentation review. Tests, CI, and documentation validation remain required; they are not additional review passes.
6. **Document the PR with `$document-release`.** Generate or update the documentation required by the actual PR inside this subtree. Include relevant usage, configuration, architecture, validation, limitations, and release notes. Update the PR's documentation section and commit/push the documentation to the same branch.
7. **Merge into `develop`.** Confirm both review stages completed, all real findings are resolved, required checks pass on the final PR head, and documentation is committed. Merge the PR into `develop` using the repository's permitted merge method; do not bypass branch protections or required checks.
8. **Clean up when safe.** Verify the PR is merged and the worktree has no uncommitted or untracked work to preserve. Confirm no active process or installed hook still refers to the temporary worktree. Remove the worktree without forcing, then delete the feature branch only when its work is preserved in `develop`. Remove the remote feature branch if safe. If cleanup is unsafe or Git refuses, retain the affected branch/worktree and report why. Never delete `develop` or unrelated branches, and never use force deletion to complete cleanup.

Resolve every review finding: correct valid findings of every severity; document false positives with source or test evidence. Do not leave real findings deferred merely because a skill normally allows minor issues to wait. Missing reviewer coverage is not a successful review.

## Review Limit Overrides

The user's explicit sequence takes precedence over skill defaults that add review passes or defer findings.

In `$document-release`, skip its default independent cross-model documentation review and its native reviewer fallback. Perform its documentation audit, updates, and normal validation without dispatching another reviewer. Apply this override only to this workflow; do not change global review settings for other projects.

Do not run a shipping helper that restarts reviews after the second stage. If execution cannot satisfy the required stages, report the specific issue instead of silently skipping a stage or adding a replacement review.

## Current Preparation State

Current state, 2026-10-01: Roe established `develop` and the independent delivery remote `https://github.com/MrZa4hands/harness-token-efficiency.git`. Phase 0 started from `f416fd89797281294c08e0062d95c5aeeba17880` in its own feature worktree. PR #1 targets `develop`; both required review stages completed and all confirmed findings were corrected. See [phase 0 validation](docs/validation/phase-0.md) and [release procedure](docs/RELEASING.md) for delivery evidence and cleanup constraints. Native registrations still refer to that worktree; retain it until withdrawal or relocation is safely completed.

Historical planning state: on 2026-09-30, `develop` was absent locally and `git ls-remote --heads origin develop` returned no matching remote branch. That absence no longer describes the independent repository.

Phase 1 preparation, 2026-10-01: PR #1 merged into develop `47ac03db561efce16c44a907bb01be72c5def40c`; PR #2 targets develop from that verified base. State/shadow decisions and requested hidden Keychain installation are implemented; both required review stages completed and all confirmed findings were corrected. Source gate 76/76. Actual calibration accepted no semantic proposals; Jev remains disabled and no token saving is claimed. See [phase 1 validation](docs/validation/phase-1.md) for negative calibration, incomplete billing, review dispositions and retained source-worktree references. Final documentation/checks/merge precede opening phase 2.

At independent initialization on 2026-10-01, the directory initially had `main` without a remote or `develop`. Earlier parent-repository observations must not be reused as this repository's delivery base.
