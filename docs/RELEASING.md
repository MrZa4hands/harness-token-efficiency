---
read_when: Before merging a phase PR or removing an implementation worktree.
---

# Release Procedure

Each phase uses its own feature branch/worktree from verified current `develop`. PRs target `develop`, even though the repository default branch is `main`. Follow [AGENTS.md](../AGENTS.md) and the [plan](plans/2026-09-30-codex-token-efficiency.md).

1. Complete implementation and meaningful failing-test-first corrections; run the full gate and record actual native integration/limitations.
2. Commit explicit source paths, excluding runtime/private evidence; push the feature branch and create its PR to `develop`.
3. Run the exact first `$review`, resolve every confirmed finding, retain honest coverage/convergence metadata, and commit/push corrections after it returns.
4. Run fresh `$superpowers:requesting-code-review` on the full merge-base-to-head range, fix all confirmed findings including minor ones, and commit/push.
5. Stop independent reviews. No renewed reviewers, shipping helper that restarts them, or independent documentation reviewer.
6. Run `$document-release` with the project's extra-review override. Update usage/configuration, architecture, evaluation, validation, release notes, and PR documentation; validate and commit/push.
7. Run the gate on the final PR head. Inspect actual PR checks and CI runs, permitted merge methods, and branch protections. No configured CI is recorded as absent, never as green. Required checks must pass; never bypass protection or use an admin merge.
8. Merge into `develop` using a permitted method and verify the merged PR's actual base and SHA.
9. Preserve any worktree still referenced by a running process, native hook, or skill. For cleanup, safely withdraw or relocate installations through normal installation and user-granted native trust. A trust-pending relocation is not complete cleanup.
10. Only after preservation in `develop`, clean Git status, and no installed/active references: remove the worktree without force and delete preserved feature branches without force. Never delete `develop` or unrelated branches. Refresh `develop` and record its new SHA before the next phase.

Current local gate:

```sh
rtk proxy node scripts/verify-context-policy.mjs
rtk proxy git diff --check
```

Do not infer native coverage from this gate. Keep credentials, transcripts, private identities, raw prompts/code, exact private usage totals, and runtime registration out of published evidence.

Phase 0 completed both review stages. First-stage coverage completed but convergence remained false at its three-fix-cycle limit; the second fresh full-range review supplied the separate mandated coverage, and its confirmed issue was corrected through TDD. Documentation adds no third review. There is no VERSION file, release tag, or standalone package release for this pilot.

Phase 1 PR #2 also completed both code-review stages. First-stage coverage completed across three internal cycles, with convergence false and all confirmed findings corrected. The second review examined `47ac03db..d7abaa21` and found one Important alias/explicit-pin transition issue; both sibling cases were corrected through separate RED→GREEN regressions in `1614195`. The source gate passes 76/76. Release documentation must preserve the negative semantic calibration, unknown exact experimental billing and absence of token promotions. Final documentation-head checks and actual merge evidence are recorded in [phase 1 validation](validation/phase-1.md).

Phase-0 hook and probe commands currently refer to the temporary phase-0 worktree. The six probes remain registered because withdrawing them invalidated the policy's source trust snapshot; exact authorized bytes were restored. Retain the worktree and branches until coordinated withdrawal/relocation and native trust are verified. This does not block preparing a new phase from merged `develop`, but it must remain explicit cleanup debt.

The phase-1 UserPromptSubmit handler also refers to its temporary worktree and remains natively trusted. A Node-path change had modified its definition; normal reinstall under the previously authorized Node 26 command restored the exact trusted entry, without altering native trust storage. Preserve both source worktrees while referenced. Keychain setup and installed runtime evidence remain private; removal does not delete the user's shared credential. No configured CI must be reported as absent rather than a passing run.

Phase 2 PR #3 completed both review stages and all confirmed TDD corrections; source gate 101/101. First-stage coverage is complete but convergence is false at its three-pass cap, with unavailable score in the exact invoked skill. The second full-range reviewer confirmed four behavior/diagnostic findings; all are fixed. Required release documentation adds no third review. Current-source native smoke verifies exact pre-generation delivery; the single historical paired task does not qualify a family.

Withdraw the temporary global trial with `manage-context-trial.mjs remove --admission <private-file> --apply` and verify its exact entry is absent before cleanup. That withdrawal succeeded after the final phase-2 smoke. Retain private evidence and fixture skill links until safely preserved or reconciled; Git-clean alone does not authorize deleting ignored execution data. No actual promotion exists. Record final merged/base/head evidence in [phase 2 validation](validation/phase-2.md) before opening phase 3.

Phase 3 PR #4 completed both required review stages: first coverage complete/convergence false at its three-cycle cap, all 26 confirmed findings corrected; fresh full-range second stage's two findings corrected in `af35956`. Corrected gate 138/138 and final-source native read/edit/check/recovery evidence are recorded in [phase 3 validation](validation/phase-3.md). Documentation adds no third review. No VERSION bump applies; there is no VERSION file.

Phase 3 merged as PR #4 into develop `ee9d8ff`; no phase-3 hook definition was installed. Retain ignored native/reviewer/component evidence and edited fixture repositories until safely preserved. The complete held-out evaluation and mode management are documented in [phase 4 validation](validation/phase-4.md).

Phase 4 PR #5 completed both reviews and all 18 confirmed TDD corrections; source `01b89de` passes 154/154. First review records completed coverage but convergence false at its three-cycle cap; the fresh second full-range review and tested correction follow the prescribed sequence. Documentation adds no third reviewer and changes no global review setting. The 207-attempt historical experiment and corrected-source report/smoke have separate bindings; neither qualifies an actual family.

Inspect actual checks/runs/protection on the final documentation head, then perform a permitted normal merge into develop. Record absent CI as absence, never green. The phase-4 global trial is withdrawn and final-source local withdrawal preserves foreign hooks/modified policy; no qualified native activation was possible. Keep production shadow/off and Jev disabled. Preserve phase-4 ignored raw evidence (207 byte-identical private transcripts plus review/fixture data); a clean tracked checkout does not permit deleting it. Earlier installed hook/skill references also require retained worktrees. No source migration or native trust fabrication is part of cleanup.
