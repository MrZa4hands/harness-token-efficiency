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
