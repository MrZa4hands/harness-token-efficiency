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

Tasks 1–6 are implemented. The latest completed gate passes 183/183 plus syntax, JSON/corpus, document links and source scope. Third-cycle corrections pass 28 focused tests, including a subsequent malformed-UTF-8 audit case. First-review native and Claude adversarial/structured coverage completed; every confirmed finding is corrected, with convergence false at the three-fix-cycle limit. The second required review remains pending. Jev stays disabled; original historical comparisons and promotions remain unchanged.

## Native Interval Validation

The new parser admits three parent responses and one worker response, excluding inherited parent history. The observed worker and parent increments match their separate cumulative counters. A second real resumed turn is measured using its prior response boundary; its known lower bound equals only that new response increment. A retained historical capture also produces an available source-bound interval lower bound. All three complete-task outputs remain unavailable because exhaustive native worker/provider closure is not verified. Native probe/resume processes completed; no extra paid cohort or retries were started.

## Historical Diagnostic Results

All 189 original held-out/repeated rows remain byte-identical. Every one of the 47 omission attempts has a separate source-hashed annotation: 21 owner-attested corpus scope mismatches and 26 unknown causes. Variant omissions are baseline 14, deterministic 16, hybrid 17. Scope annotations identify whole-source-body requirements beyond explicitly scoped execution, occurrence-search or empty-range requests; they do not overturn original grades. The retained full-body matcher is a conservative aid, not proof that relevant delivery was absent. No delivery or answer cause is assigned without independent evidence.

Two check failures remain separately annotated: a native capacity failure before requested check execution, and a broader full test suite than the requested single test. Corpus, assessments and original reports are unchanged; no family is promoted.

## Missing-Audit Characterization

`native_hybrid_trial_missing_prior_audit_abstains_with_reason` deterministically forces the first observation write to fail. Saved state persists, context is discarded, the next turn leaves state unchanged and records `prior-conversation-unverified`. Production already passes; this is a characterization, not a claimed failing-first defect repair. Successful continuity includes per-child status and audit diagnostics; deadlines are unchanged.

## RED/GREEN and Limits

New parser, interval accounting, private measurement CLI and evidence diagnostics each first failed their behavioral assertions against empty interface stubs. Focused suites subsequently pass. Private input regressions cover inherited history, duplicate/conflicting responses, resets, overflow, snapshot growth, symlink/FIFO/nonprivate sources, outside paths, source hashes and aggregate budgets. Complete synthetic token coverage is not asserted: Task 1 found no native exhaustive closure contract, and the adapter refuses invented closure events or owner flags. Proof hashes have typed owner-attested kinds; they authenticate no causal claim against a malicious owner. Native CLI evidence does not establish Desktop worker support. Monetary cost remains unknown.
