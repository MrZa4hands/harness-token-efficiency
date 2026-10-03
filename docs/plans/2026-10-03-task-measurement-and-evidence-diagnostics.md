# Complete Task Measurement and Evidence Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Account for observed complete-task consumption without double counting, and explain the retained evidence omissions before another optimization experiment.

**Architecture:** Extend the existing offline evaluation tools with a version-bound transcript adapter, a task accounting function and an evidence diagnostic command. Read immutable private captures; preserve unknown coverage and historical assessments. Add no resident observer, replacement client, new policy framework or automatic activation.

**Tech Stack:** Existing Node.js ESM, standard library, Git, rg and RTK; existing native Codex App/CLI and Keychain configuration.

**Spec:** [Approved pilot specification](../codex-token-efficiency-spec.md), requirements R4–R7 and sections 10–11; [required workflow](../../AGENTS.md). This plan proposes the additional offline contracts below for review. It does not amend the approved promotion thresholds.

**read_when:** Before implementing complete-task usage accounting, diagnosing phase-4 omissions, or preparing a new evaluation.

**Execution:** Preserve the selected native method: root implements tasks with `superpowers:executing-plans`; use exactly the two project-required PR review stages. Skill defaults cannot add per-task or final independent reviews.

## Global Constraints

- Preserve the current interface, model, effort, permissions and native trust; no alternate App Server or execution overrides.
- Existing budgets: Jev 1 second and zero retries; preparation 2 seconds; native handler 3 seconds; Jev/context 6,000 UTF-8 bytes; hook context approximately 2,000 tokens; routine wrapper output 8,000 bytes; operational state 7 days.
- Promotion remains at least 20% median total-token reduction, no median latency increase, p95 increase at most 1,000 ms, complete required quality and at least ten family pairs within the existing complete sixty-task/three-variant corpus contract.
- Jev remains disabled, production shadow/off, promotions unchanged and command rewriting passthrough. No changes to thresholds, corpus, labels or old run identities.
- Keep all source/tests/docs in this repository; English prose, comments and identifiers; files below approximately 500 lines; no new dependencies.
- Private captures use 0700 directories and 0600 files. Do not publish prompts, transcripts, credentials, private identities or exact private-session totals.
- Unknown usage is null, not zero. Subscription billing cannot be priced from token counters; cost stays null without independent verified billing.
- Do not automatically retry paid failures or discard incomplete runs. Do not fabricate worker closure, native delivery, trust or provider usage.
- Planning changes are documentation only. Implementation starts after this written plan is reviewed, in a new worktree from verified current develop.

## Starting Evidence and Scope

On 2026-10-03, fetched local/remote develop both resolve to `d394c65dd236ae5e16f8f683938e025c3a74fe1d`, the normal PR #5 merge. Primary checkout remains main `f416fd8`; do not implement there. Reverify these facts at execution time.

Phase 4 retained 207 scheduled attempts: 18 tuning, 180 primary and nine repeats. The held-out/repeated cohort has 189 attempts, 185 completions, 179 correct answers, 47 evidence omissions and two incomplete/broadened checks. Complete worker/provider accounting is unverified; 52 runs have unknown Jev billing. Native source `746478d` and corrected source `01b89de` remain separate. No family qualifies.

The final documentation head `e498ff0` passed 154/154 after a retained 153/154 run: first hybrid turn state existed without its audit, so the next turn correctly abstained. The original abort cause was not captured. A later isolated test and full unchanged gate passed; do not label this a proven timeout or a repaired defect.

**Included:** offline measurement contracts, bounded private readers, actual native counter calibration, independent historical omission annotations, and deterministic diagnostics for missing turn audits.

**Excluded:** optimizer recipe changes, a new corpus, new held-out comparisons, enabling Jev, promotion, model routing, main release, hook relocation and deleting retained worktrees. Those need subsequent plans informed by these results.

## Review Focus

1. Resumed/inherited worker history: count only observed responses belonging to the admitted task/thread; Task 2 tests inherited prefixes and Task 3 tests interval boundaries.
2. Missing, late or failed workers/provider attempts: incomplete closure must produce null complete-task totals; Task 3 tests omitted descendants, late completion and unknown billing.
3. Growing files, symlinks, FIFOs or private-data diagnostics: bounded snapshot reads and generic errors; Task 2/4 tests real filesystem boundaries and secret sentinels.
4. Evidence absent from an answer versus absent from delivered context: preserve independent source-backed assessments; Task 5 tests both and contradictory annotations.
5. State saved without prior audit: following turns abstain with a captured diagnostic, while successful continuity remains unchanged; Task 6 deterministically tests audit failure.

## File Responsibilities

| Path | Responsibility |
|---|---|
| `src/task-usage-transcript.mjs` (new) | Version-bound read-only task/thread normalization; inherited-prefix handling, response identity and source provenance. |
| `src/task-usage.mjs` (new) | Pure interval accounting, worker/provider completeness and independent per-provider totals. |
| `scripts/measure-task-usage.mjs` (new) | Private manifest/capture/decision loading and structured offline CLI output. |
| `src/pilot-evidence-diagnostics.mjs` (new) | Validate and aggregate separately annotated historical omissions; never regrade original runs. |
| `scripts/diagnose-pilot-evidence.mjs` (new) | Private historical input/output boundary; diagnostic CLI. |
| `tests/task-usage-transcript.test.mjs`, `tests/task-usage.test.mjs`, `tests/task-usage-cli.test.mjs` (new) | Parser, arithmetic/coverage and real CLI regressions respectively. |
| `tests/pilot-evidence-diagnostics.test.mjs` (new) | Assessment validity, aggregation, retention and private CLI boundary. |
| `tests/context-trial.test.mjs` (existing) | Deterministic missing-audit diagnostic and per-turn assertion details. |
| `evaluation/fixtures/task-usage-01592.jsonl` (new) | Synthetic native-shaped records, deidentified and validated against retained calibration. |
| `docs/validation/task-measurement.md` (new) | Safe native calibration/diagnostic findings and explicit measurement limits. |

Reuse `collectCodexUsage` and `collectJevUsage` from `src/pilot-evaluation.mjs`; preserve their exports and session-only CLI behavior. `src/context-promotion.mjs`, production policy and historical corpus remain unchanged.

## Task 0: Establish the Execution Worktree and Preserve Evidence

- [ ] Read `superpowers:using-git-worktrees`; resolve the primary repository through the absolute git-common-dir. Check all relevant working-tree statuses and active installed references.
- [ ] Fetch origin develop; require local develop to equal the verified remote tip or fast-forward it safely. Stop on divergence; never substitute main or reset work.
- [ ] Create branch `feat/task-measurement-and-evidence-diagnostics` and sibling worktree `../codex-token-efficiency-worktrees/task-measurement`. Reuse no previous phase worktree for implementation.
- [ ] Record starting develop SHA, absolute worktree, feature branch, PR base develop and clean starting status in a private execution manifest. Copy this reviewed plan into the new worktree without overwriting an existing tracked file.
- [ ] Run `rtk proxy node scripts/verify-context-policy.mjs`; record all outcomes, including any timing failure, before implementation.
- [ ] Snapshot hashes of the immutable historical manifests, assessed JSONL, reports and original corpus. Preserve source bindings and raw evidence in place; diagnostics write sibling artifacts, not replacements.

## Task 1: Pin the Observable Native Accounting Contract

**Files:** `docs/validation/task-measurement.md`; private execution directory `.superpowers/sdd/2026-10-03-task-measurement/`.

**Produces:** verified native field paths for response identity, subject thread, root task/turn, parent/child relationships, usage scope and terminal outcomes; sanitized synthetic input for Task 2. This task changes no runtime behavior.

- [ ] Inspect only retained phase-0 parent/worker calibration metadata and counter records. Establish whether parent counters include workers and how inherited prefixes distinguish themselves from the worker's own responses. Do not guess field names from documentation.
- [ ] Recheck actual native client/version and actual model/effort. The current adapters admit only observed 0.159.2/0.159.3; a different version is unknown until independently calibrated and tested. Do not change user settings to fit a probe.
- [ ] Probe one synthetic native task with one joined worker in the current interface, preserving the ordinary native path and permissions. Capture actual response increments, cumulative counters, child discovery/join events and terminal outcomes privately. Keep all failed/abstained attempts; no automatic paid retries.
- [ ] Determine whether the observed native records can enumerate and close every worker and Jev attempt for this task. An empty list or a caller's `complete:true` is not proof. If discovery/closure is unavailable, record the missing boundary and make complete-task output unavailable; do not add a server or replace the client.
- [ ] Freeze the observed schema and source hashes. Write a sanitized validation note; raw events stay private. Native CLI evidence does not establish Desktop worker coverage.
- [ ] Commit the factual validation note with a detailed Conventional Commit. Missing closure is a reported limitation, not a successful completeness result.

## Task 2: Read Task-Scoped Native Captures Safely

**Files:** new `src/task-usage-transcript.mjs`, `tests/task-usage-transcript.test.mjs`, `evaluation/fixtures/task-usage-01592.jsonl`.

**Interface:** `readTaskUsageTranscript(path, {client_version, thread_id, root_session_id, root_turn_id}) -> Promise<Capture>`.

`Capture` contains `available`, admitted identities, `source_sha256`, `snapshot_bytes`, normalized subject response records `{response_id, usage}`, initial/final cumulative counters, observed parent/child and terminal records, and `limitations`. No prompt/code bodies escape the reader. Native field mappings come exclusively from Task 1.

- [ ] Write failing tests `task_transcript_excludes_inherited_parent_responses` and `task_transcript_rejects_unverified_subject`: inherited parent plus worker rows return only the worker's increments; unrelated/missing identities remain unavailable. Exact duplicate response IDs count once; contradictory duplicates reject.
- [ ] Write boundary regressions: unsupported version, mixed model/effort, missing counter, malformed interior line, unexplained reset, overflow, growing-file append, symlink, FIFO and `PRIVATE_TRANSCRIPT_VALUE` sentinel. Assert null unknown counters and no sentinel in stdout/stderr/errors.
- [ ] Run `rtk proxy node --test tests/task-usage-transcript.test.mjs`; observe the intended missing behavior, not a syntax/import-only accident.
- [ ] Implement the minimum reader with `O_NOFOLLOW|O_NONBLOCK`, owner/private/regular-file validation, initial-size bounded streaming and source hashing over exactly those bytes. Per-plan offline limits: at most 64,000,000 bytes per transcript; oversized/changed/truncated captures cannot certify closure. These limits do not alter hook budgets.
- [ ] Normalize only subject-bound response/cumulative records from the verified schema. Inherited prefixes are not silently accepted as counters; unsupported or ambiguous resets stay unavailable. Reuse existing counter validation, not a second inconsistent arithmetic contract.
- [ ] Rerun focused tests to green, refactor only while green, then commit `feat: read task-scoped native usage captures` with detailed rationale and validation.

## Task 3: Account for Intervals, Workers and Every Provider

**Files:** new `src/task-usage.mjs`, `tests/task-usage.test.mjs`.

**Interface:** `collectCompleteTaskUsage(manifest, captures, decisions) -> TaskUsage`.

`manifest` version 1 binds task/run, actual native version/model/effort, root session/turn, source hashes, admitted thread intervals and native worker/provider closure evidence. Each interval identifies exact boundary counters and admitted response IDs. Closure references captured native discovery/join/terminal evidence; naked attestation flags are insufficient. Parent/child inclusion semantics must match Task 1.

Required manifest keys: `manifest_version:1`, `task_id`, `run_id`, `client_version`, `main_model`, `reasoning_effort`, `root_session_id`, `root_turn_id`, `captures`, `intervals`, `decisions`, `closure`. A capture descriptor is `{path, sha256, thread_id}`; decisions use `{path, sha256}`. An interval is `{thread_id, start_response_id, end_response_id, initial_usage, final_usage, response_ids}`; a proven fresh thread uses `start_response_id:null` and zero initial counters. Closure is `{worker_source_refs, provider_source_refs}` where each reference binds a capture hash and native record index. The parser validates those referenced records against Task 1's frozen schema, identities and terminal outcomes; references cannot create events absent from the capture.

`TaskUsage` returns `measurement_scope:"task"`, `task_coverage_verified`, `codex_usage`, `jev_usage`, `providers:{codex,jev}`, `known_lower_bound:{codex_total_tokens,jev_total_tokens}`, `cost:null`, `limitations` and source hashes. Codex/Jev counters reuse the existing six-field/three-counter shapes respectively; `providers` repeats each provider's separate summary and is not another billable total. Complete totals are null when any necessary source is unknown; known partial usage stays separately labelled. Valid zero Jev requires captured no-attempt evidence across every admitted thread. A closed failed task may have complete consumption; failure never becomes successful quality.

- [ ] Write failing test `task_usage_counts_interval_and_worker_once`: root starts input/output 100/20 and ends 180/40, child contributes 30/10; subject increments agree. Assert Codex total 140; cached/reasoning remain included subsets, never extra tokens. Add duplicate snapshots, response IDs and resumed-task boundaries.
- [ ] Write `task_usage_includes_rejected_provider_attempts`: the complete case above plus independently valid Jev input/output 7/3 returns provider totals 140 and 10, even when classification is rejected; attempts deduplicate by decision ID.
- [ ] Write tests for missing/grandchild/late worker closure, cross-task threads, differing actual model/effort, overlapping intervals, unobserved task start, inconsistent increment/final counters, conflicting decision copies, missing Jev audit, abandoned query and arithmetic overflow. Assert false coverage/null totals with retained lower bounds.
- [ ] Run `rtk proxy node --test tests/task-usage.test.mjs` and observe RED for the intended behavior.
- [ ] Implement the pure function; subtract verified interval boundaries, verify against admitted response increments, account for independently proven separate workers, and reuse `collectJevUsage`. Fail closed when native inclusion or closure cannot be established. Never infer zero from variant/mode labels.
- [ ] Verify GREEN and unchanged existing usage tests with `rtk proxy node --test tests/task-usage.test.mjs tests/pilot-evaluation.test.mjs`; commit `feat: account for complete task and provider usage` with limitations.

## Task 4: Expose Bounded Offline Measurement

**Files:** new `scripts/measure-task-usage.mjs`, `tests/task-usage-cli.test.mjs`.

**Interface:** `rtk proxy node scripts/measure-task-usage.mjs --manifest /private/task.json` outputs one `TaskUsage` JSON object. Exit 0 requires verified complete token coverage; exit 1 returns structured unavailable/partial results and generic diagnostics. Unknown monetary cost alone does not invalidate verified token counts.

The result contains hashes and aggregate counters, not raw session/thread/response identities. Direct output to a new 0600 private file with a restrictive umask; inspect only safe aggregate status. Diagnostic reads do not establish App support from CLI support or repair missing historical billing.

- [ ] Write failing CLI tests for a complete synthetic task and incomplete worker/provider task. Assert exact exit status/JSON, unchanged inputs, no network invocation and no secret sentinel disclosure.
- [ ] Add actual file-boundary regressions: manifest/decisions above 4,000,000 bytes, nonprivate files, symlinks/FIFOs, unknown arguments, conflicting source hashes, paths outside the private manifest directory and total transcript input above 512,000,000 bytes. Do not follow external references or scan all user sessions.
- [ ] Run `rtk proxy node --test tests/task-usage-cli.test.mjs`; observe expected RED.
- [ ] Implement explicit manifest-relative paths with canonical containment, at most 128 captures, initial-size reads and final canonical JSON at most 4,000,000 bytes. Use Tasks 2–3 interfaces. No credentials, price lookup, paid inference, automatic discovery guesses or mutation of raw sources.
- [ ] Verify GREEN and existing session `usage` compatibility; commit `feat: expose private offline task measurement`.
- [ ] Apply the command to retained historical captures only where the manifest can be source-backed. Preserve unknown historical worker/Jev boundaries; do not fill them to reach favorable totals or write promotion rows.

## Task 5: Diagnose Historical Evidence Omissions Independently

**Files:** new `src/pilot-evidence-diagnostics.mjs`, `scripts/diagnose-pilot-evidence.mjs`, `tests/pilot-evidence-diagnostics.test.mjs`; private sibling annotation/report artifacts.

**Interfaces:** `diagnosePilotEvidence(tasks, runs, assessments) -> EvidenceDiagnostic`; CLI `rtk proxy node scripts/diagnose-pilot-evidence.mjs --tasks evaluation/tasks.jsonl --runs /private/runs.jsonl --assessments /private/assessments.jsonl`.

Each assessment binds original run/task, original run-row SHA-256, requirement and source-proof hashes, with one primary cause: `selection_or_delivery`, `answer_omission`, `corpus_scope_mismatch` or `unknown`. `answer_omission` requires independent delivered-evidence proof; `selection_or_delivery` requires trace proof of protected evidence missing from the relevant delivery. Human cause annotations are owner-attested diagnostics, not machine-proven correctness. Contradictory/missing annotations remain unknown. Mixed secondary factors may be described without double-counting the primary cause.

Assessment keys are `run_id`, `task_id`, `run_row_sha256`, `requirement_ids`, `proof_sha256s`, `primary_cause`. The report returns `diagnostic_version:1`, `attempt_count`, `omission_attempt_count`, `cause_counts`, `unassessed_attempt_count`, `invalid_assessment_count`, `limitations` and a private `details` array of those bound assessments. Only sanitized aggregate counts leave the private report. Hash original row bytes exactly as frozen; do not reserialize rows to invent provenance.

- [ ] Write failing tests `evidence_diagnostics_distinguish_delivery_from_answer` and `evidence_diagnostics_preserve_original_grades`: identical omission grades with different source-backed delivery proofs get distinct causes; original input bytes and `quality` booleans never change.
- [ ] Test scope mismatches, stale source hashes, duplicate/contradictory annotations, unsupported cause labels, missing assessments, failed runs and private CLI boundaries. Missing diagnostic annotations must not erase omitted attempts or imply a repaired task.
- [ ] Run `rtk proxy node --test tests/pilot-evidence-diagnostics.test.mjs`; observe expected RED.
- [ ] Implement bounded private JSONL loading using the Task 4 boundary rules; validate against the exact original corpus/run hashes. Produce attempt-level counts, requirement details, unknown/unassessed IDs and separately identified tuning results; never expose raw text through the report.
- [ ] Verify GREEN, then commit `feat: diagnose retained pilot evidence omissions` with the distinction between diagnostics and quality assessment.
- [ ] Annotate all 47 held-out/repeated omission attempts from their retained proofs, including baseline, deterministic and hybrid. Treat the count as affected attempts, not 47 unique requirements. Diagnose the two check-scope failures separately. Tuning omissions remain outside held-out totals.
- [ ] Reconcile primary cause counts plus unassessed/unknown to all 47 attempts. Retain counterfactuals as hypotheses; do not attribute a baseline omission to an optimizer that did not deliver context. Publish only safe aggregate findings and links to corrective test cases.

## Task 6: Make Missing-Audit Failures Diagnosable

**Files:** `tests/context-trial.test.mjs`; modify `src/context-trial.mjs` only if a meaningful failing regression proves incorrect diagnostic behavior.

**Consumes:** retained first-turn-state/missing-audit failure. **Produces:** a deterministic regression with captured per-turn result, not a host-load-dependent retry.

- [ ] Write `native_hybrid_trial_missing_prior_audit_abstains_with_reason`: use the existing isolated-home/fetch fixture, force the first observation write to fail, verify persisted first-turn state and missing audit, then verify the second turn leaves state unchanged and records `prior-conversation-unverified`.
- [ ] Improve successful continuity assertions to include each child status, stderr and safe expected-audit status before asserting final turn state. Do not print prompts, response bodies or credentials.
- [ ] Run `rtk proxy node --test tests/context-trial.test.mjs`. Observe RED for a real missing diagnostic assertion if present; if production already behaves correctly, record characterization PASS rather than claiming a nonexistent failing-first fix.
- [ ] For any proven behavioral defect, read `superpowers:test-driven-development`, add the smallest meaningful failing case, observe its expected failure, fix minimally, verify GREEN and refactor with tests green. Preserve all 1/2/3-second deadlines; do not add retry loops or remove continuity assertions to hide timing failures.
- [ ] Commit the resulting regression/diagnostic changes with a detailed `test:` or `fix:` message. If ambient timing still fails, retain full child diagnostics and investigate before merge; an unexplained intermittent failure is a reported limit.

## Task 7: Native Validation and Delivery

- [ ] Verify task measurement against Task 1's real closed parent/worker capture: per-response sums, interval deltas and native cumulative counters agree, or output explicitly states the unsupported boundary. A synthetic pass cannot certify native worker discovery.
- [ ] Verify a real resumed-task boundary without counting earlier unrelated work. Capture only the admitted task's identities/hashes/counters; retain actual failures. No new paired cohort or favorable paid retry is authorized by this diagnostic plan.
- [ ] Verify incomplete worker/provider fixtures yield unavailable totals; unchanged historical report still has no promotions. Keep Jev disabled and hook trust/configuration unchanged.
- [ ] Run the complete gate `rtk proxy node scripts/verify-context-policy.mjs` and `rtk proxy git diff --check`. Save RED/GREEN and full gate evidence; do not call absent CI green.
- [ ] Commit remaining owned implementation/validation files in logical Conventional Commit groups, excluding runtime/raw evidence. Push the feature and create a PR explicitly targeting develop with scope, plan, native limits and validation.
- [ ] First review: read the exact `/Users/mrz/Documents/keldai/tools/gstack/.agents/skills/gstack-review/SKILL.md`; run `$review` against develop. Resolve every confirmed finding through TDD, retain evidence-backed false-positive dispositions, and commit/push corrections after this stage returns.
- [ ] Second review: read `$superpowers:requesting-code-review`; dispatch a fresh reviewer with this plan, approved requirements and actual merge-base(origin/develop, HEAD)..HEAD range. Correct every confirmed severity through TDD, verify and commit/push to the same PR.
- [ ] Stop reviews after the second stage and corrections. Do not rerun reviewers or dispatch an independent documentation reviewer. Required tests, CI and documentation validation continue.
- [ ] Read and run exact `$document-release` from `/Users/mrz/Documents/keldai/tools/gstack/.agents/skills/gstack-document-release/SKILL.md`. Update README, `docs/evaluation.md`, `docs/usage.md`, architecture, validation and CHANGELOG for actual delivered scope; preserve historical entries. Skip its independent cross-model/native fallback per project override; do not change global review settings. Commit/push documentation and update the PR body.
- [ ] Run required checks on the final documentation head; inspect actual GitHub runs/checks and develop protections/rules. Confirm both reviews complete and all real findings resolved; merge normally into develop with the permitted method, without bypass or main merge.
- [ ] Verify merged SHA and preserved feature history; fast-forward local develop safely. Check worktree tracked/untracked/ignored content, active processes and installed hook/skill references. Archive evidence with hash verification before removal. Remove the worktree without force only when safe, then delete preserved feature branches; otherwise retain/report each reason. Never delete develop or unrelated resources.

## Acceptance and Handoff

- Complete totals require actual source-backed task boundaries, every admitted thread and every provider; unexplained gaps yield null totals with useful separately labelled partial data.
- Captures account for expansions/corrections and cached/reasoning subsets exactly once; inherited/resumed unrelated history is excluded only with verified identity boundaries.
- Every one of the 47 historical affected attempts is retained in diagnostics; grades, corpus and original reports remain byte-identical. Unknown causal evidence stays unknown.
- The missing-audit regression is deterministic, preserves conservative abstention and yields diagnostic evidence without raising production deadlines.
- Positive native measurement is claimed only for the individually verified interface/version/task scope; unobservable closure remains an explicit limitation, not a fabricated success.
- Both required reviews, all corrections, documentation, final-head checks and normal develop merge complete before delivery is declared done.
- A subsequent proposal may select a deterministic family, corrective recipe and prospective frozen corpus using these findings. This plan itself demonstrates no savings, enables no optimization, migrates no installation and releases nothing to main.

## Author Self-Review

R4/R7 map to Tasks 1–4; R5 to Task 5; R6 to Task 6; existing R1/R2/R3/R8 behavior remains unchanged. Each new behavioral task includes explicit RED, minimum implementation, GREEN and commit steps. Native-contract failures stop unsupported accounting while preserving useful diagnostic output. Review Focus items all have owning tests. Runtime/parser/measurement interfaces remain distinct; no generic observer or policy abstraction is introduced. The delivery sequence preserves the exact two-review limit and selected native execution method.

**Status:** Written plan pending Roe's review; no implementation or paid native experiment started.
