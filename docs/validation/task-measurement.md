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

## PR #6 Progress

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

PR #6 merged normally into develop `b0c405a056d3abea9ce1bae106eb5465690db31c`. Its source, documentation and feature history are preserved there. Actual checks/runs and protection were inspected; absent CI was not represented as green. There is no VERSION file or release tag. Documentation does not enable a hook, change trust, migrate installed sources or activate Jev.

The PR #6 task-measurement worktree and feature branches were removed without force after its ignored native/reviewer/historical evidence was preserved and individually hash-verified in the primary checkout's private `.superpowers/archives/2026-10-03-task-measurement-trkc1wq7` archive. Originals also moved to Trash. The archive's cleanup receipt records actual removal; its older delivery ledger remains unchanged. Earlier installed source references retain their existing preservation requirements. See [release procedure](../RELEASING.md).

## PR #7 Engineering Follow-up

The approved R1–R5 refinements use fresh branch `feat/task-measurement-review-refinements`, worktree `task-measurement-refinements`, starting develop `b0c405a056d3abea9ce1bae106eb5465690db31c`, and PR base develop. The primary checkout's original reviewed plan remains untouched; the executed tracked plan retains PR #6 history and appends Tasks 8–12.

Initial unchanged baseline passed 184/185: `project_check_cancellation_stops_descendants` returned `ok` instead of `timeout`. It passed unchanged in isolation and subsequent full gates; no cancellation repair or deadline change is claimed. Corrected follow-up source `3f2b58c` passes 215/215; the four affected suites pass 60/60. Syntax, JSON/corpus, links, source scope and whitespace checks pass. Private logs retain every observed RED/GREEN and failed reviewer attempt.

Behavior coverage includes explicit multi-turn membership, reused worker subsets, selected-context conflicts in both orders, inherited-prefix exclusion, indexed intervals, original LF/CRLF/EOF hashes, authoritative row wrappers, unknown/unassessed semantics, bounded identities and typed billing, shared source/invocation caps, canonical decision snapshot reuse, and requested private report saves. Descriptor regressions cover same-size rewrites, truncation, parse failure followed by mutation, rename/held-inode changes and read errors; detected instability rejects the full load. No heap/runtime improvement is inferred from resource caps.

The exact first `$review` completed specialist/native and required Claude adversarial/structured coverage. Three core fix cycles reached their cap, so core convergence remains false and the unavailable skill score is not invented. Missing outside components were recovered with the same configured provider/model and child-only `high` effort; global settings remained unchanged. All supported findings were corrected with TDD, final outside fix verification returned valid no-findings results, and the complete corrected gate passed 211/211. Original failures and recovery provenance remain retained.

The fresh second `$superpowers:requesting-code-review` examined the entire `b0c405a..0dc67da` range, independently passed 56/56 focused tests, and found one P2: a great-grandchild of a rejected worker could still contribute response tokens and provider turns. Conflicted/missing ancestor and ancestry-cycle regressions first failed; `3f2b58c` now requires every admitted worker's acyclic ancestry to reach the root before accounting. Valid rooted chains, both capture orders and independent root/provider bounds remain covered. No Critical or Minor findings were reported; all confirmed findings are resolved. Release documentation follows the project override without another independent reviewer.

Three archived native manifests are replayed with corrected source: parent/worker, resumed parent and derived explicit two-turn membership with a first-turn-only worker. Every admitted bound matches separately summed native response increments; outputs remain partial with null complete totals and cost. No new paid probe, native setting/trust change, Desktop-worker certification or optimizer qualification is claimed.

All 189 original diagnostic rows replay with separately rebound annotations after verifying PR #6's LF-excluding row correspondence. New hashes include actual row terminators; originals remain unchanged. Results retain 47 omissions, 21 owner-attested scope mismatches and 26 unknown causes, invalid annotations zero and unassessed omissions zero. All 17 recovered evidence/provenance files retain their original hashes. PR #6's all-189-capture measurement remains historical; this follow-up does not claim an all-189 native capture replay.

PR #7 still requires the final documentation-head gate, actual CI/protection inspection and a permitted normal merge before cleanup. Its private reviewed plan, ledger, reviewer usage, failed attempts and replay artifacts must be hash-archived before nonforced worktree/feature-branch removal. Final merge and cleanup receipts record actual outcomes after these actions; earlier installed worktrees and unrelated branches remain preserved.
