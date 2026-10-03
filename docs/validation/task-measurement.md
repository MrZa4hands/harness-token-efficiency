---
read_when: Before measuring complete-task usage or interpreting historical evidence diagnostics.
---

# Task Measurement Validation

## Starting State

- Starting develop: `d394c65dd236ae5e16f8f683938e025c3a74fe1d`.
- Feature: `feat/task-measurement-and-evidence-diagnostics`; PR base `develop`.
- Native inline execution, new sibling `task-measurement` worktree.
- Baseline gate: 154/154; syntax, JSON/corpus, document links and source scope pass.
- Original corpus, assessed runs, source binding and reports hashed privately before changes.

## Native Accounting Calibration

One new native CLI task spawned one worker and waited for it, with unchanged configured `0.159.2`, `gpt-6.1-sol`, `high`, permissions and hook trust. Parent and worker each have independent response increments matching their own thread cumulative counters. The worker capture contains inherited parent history; only subject-bound increments belong to that worker. Raw captures and exact private usage remain in private 0600 artifacts. This CLI evidence does not certify Desktop worker discovery.

Observed native fields:

- `session_meta.payload`: `id`, `session_id`, `cli_version`; workers additionally `parent_thread_id`, `agent_path`, `subagent_history_start_ordinal`.
- `turn_context.payload`: `turn_id`, `root_turn_id`, `model`, `effort`.
- `token_usage_record.payload`: `response_id`, `thread_id`, `session_id`, `turn_id`, `root_turn_id`, `usage`, `turn_token_usage`, `thread_token_usage`.
- `event_msg.payload`: `task_started`/`task_complete` with `turn_id`; terminal records contain actual completion times.
- Spawn output carries an agent path; wait output says wait completed without enumerating closed worker identities.

Cached input and reasoning output are included subsets, never added again. A complete-turn counter is not proof that every descendant or provider attempt is known. Native records do not supply authenticated exhaustive worker/provider closure; total-task coverage remains unavailable on this calibrated adapter. Boundary arithmetic and known partial usage can still be validated. Missing source boundaries remain unknown rather than owner-attested complete.

## Progress

Tasks 0–6 and native/historical validation are implemented in PR #6 to develop. Both required reviews and all confirmed corrections are complete. Corrected source `3c301b3` passes 185/185 plus syntax, JSON/corpus, document links and source scope; the focused measurement/diagnostic suite passes 30/30. Jev stays disabled; original historical comparisons and promotions remain unchanged. Final documentation-head checks and actual merge evidence are retained in the private execution ledger; no configured CI is represented as green.

## Required Reviews

The exact first `$review` completed three internal native fix cycles and Claude adversarial/structured coverage. All 11 unique confirmed findings, including factual documentation, are corrected. Original outside-provider timeouts remain retained beside successful bounded re-executions; they are not overwritten as clean runs. Coverage is complete, convergence is false at the three-fix-cycle limit, and an unavailable skill score is not invented. Corrections cover native identity hashes, bounded public corpus reads, actual snapshot budgets, ancestor replacement, independent partial bounds, source path/hash binding, unknown variants, private errors and factual state.

The fresh second `$superpowers:requesting-code-review` examined the entire `d394c65..4ff9fc2` range with the plan, specification and native producers. It independently passed the then-current 183-test gate and found one Important issue: safe empty worker/audit/annotation files erased other usable results. Two new regressions failed for the expected reason, then passed after the minimal opt-in empty-snapshot correction in `3c301b3`. Empty captures/audits remain unavailable; empty assessments preserve unknown omitted attempts. All confirmed findings are resolved. No further independent reviewer was dispatched; release documentation uses the explicit project override.

## Native Interval Validation

The new parser admits three parent responses and one worker response, excluding inherited parent history. The observed worker and parent increments match their separate cumulative counters. A second real resumed turn is measured using its prior response boundary; its known lower bound equals only that new response increment. A retained historical capture also produces an available source-bound interval lower bound. All three complete-task outputs remain unavailable because exhaustive native worker/provider closure is not verified. Native probe/resume processes completed; no extra paid cohort or retries were started.

Final-source offline remeasurement examines all 189 retained held-out/repeated captures: verified final-root-turn Codex bounds are baseline 63/63, deterministic 62/63 and hybrid 62/63 (187/189 overall). These scopes exclude prior associated setup/follow-up turns and are not relabelled whole-conversation or complete-task totals. Independently admitted observed Jev aggregates are 52, 53 and 17 respectively (122/189); other aggregates remain unknown, rather than zero. This narrower turn/source binding differs from original historical billing scope. Every complete-task result remains unavailable. Byte hashes for the original corpus, assessed rows, execution manifest, source binding and generated report remain unchanged; derived manifests and source-copy provenance remain private.

## Historical Diagnostic Results

All 189 original held-out/repeated rows remain byte-identical. Every one of the 47 omission attempts has a separate source-hashed annotation: 21 owner-attested corpus scope mismatches and 26 unknown causes. Variant omissions are baseline 14, deterministic 16, hybrid 17. Scope annotations identify whole-source-body requirements beyond explicitly scoped execution, occurrence-search or empty-range requests; they do not overturn original grades. The retained full-body matcher is a conservative aid, not proof that relevant delivery was absent. No delivery or answer cause is assigned without independent evidence.

Two check failures remain separately annotated: a native capacity failure before requested check execution, and a broader full test suite than the requested single test. Corpus, assessments and original reports are unchanged; no family is promoted.

## Missing-Audit Characterization

`native_hybrid_trial_missing_prior_audit_abstains_with_reason` deterministically forces the first observation write to fail. Saved state persists, context is discarded, the next turn leaves state unchanged and records `prior-conversation-unverified`. Production already passes; this is a characterization, not a claimed failing-first defect repair. Successful continuity includes per-child status and audit diagnostics; deadlines are unchanged.

## RED/GREEN and Limits

New parser, interval accounting, private measurement CLI and evidence diagnostics each first failed their behavioral assertions against empty interface stubs. Focused suites subsequently pass. Private input regressions cover inherited history, duplicate/conflicting responses, resets, overflow, snapshot growth, symlink/FIFO/nonprivate sources, outside paths, source hashes and aggregate budgets. Complete synthetic token coverage is not asserted: Task 1 found no native exhaustive closure contract, and the adapter refuses invented closure events or owner flags. Proof hashes have typed owner-attested kinds; they authenticate no causal claim against a malicious owner. Native CLI evidence does not establish Desktop worker support. Monetary cost remains unknown.

## Delivery and Retention

PR #6 targets develop and requires the final documentation-head gate, actual checks/runs, permitted merge methods and protection inspection before a normal merge. The repository has no configured CI or branch rules at the inspected source head; final-head inspection remains mandatory. There is no VERSION file or release tag. Documentation does not enable a hook, change trust, migrate installed sources or activate Jev.

The task-measurement worktree contains ignored native transcripts, reviewer evidence, exact historical copies and annotation provenance. Retain that worktree and its local/remote feature branches until a hash-verified evidence archive permits safe removal. Tracked Git-clean status alone cannot authorize deleting ignored data. Earlier installed source references have their existing retention requirements. See [release procedure](../RELEASING.md).
