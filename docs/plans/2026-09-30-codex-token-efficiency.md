# Codex Token Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for native execution or `superpowers:subagent-driven-development` if Roe selects delegation. Implement task-by-task with checkbox tracking. Project instructions override extra review gates: exactly the two review stages below for each PR.

**Goal:** Reduce total tokens and time per correctly completed task through automatic context preparation and known local operations, preserving the current interface, model, effort, permissions, and required evidence.

**Architecture:** Project-local native hooks call a small Node program without a resident process. Local rules resolve facts; Jev classifies bounded semantic decisions in shadow before its decisions can execute actions. Exact evidence, progressive retrieval, and explicit invalidation protect coverage; paired evaluation determines activation per operation family.

**Tech Stack:** Installed Node, `.mjs` modules, standard library (`node:test`, `node:assert/strict`, `node:fs/promises`, `node:crypto`, `node:child_process`), `fetch`, Git, `rg`, and RTK. No new dependencies or package manager.

**Spec:** [Pilot specification](../codex-token-efficiency-spec.md), R1–R8 and phases 0–4. Also read [AGENTS.md](../../AGENTS.md), [README.md](../../README.md), and [research](../codex-token-efficiency-proposal.md).

**Status:** Roe authorized implementation on 2026-10-01; native inline execution selected. Phases 0–2 merged; current develop is `f5253237b2e747b713aee153367321e68bd29b31`. Phase 3 PR #4 implements exact artifact reuse, conservative delivery guards, owned physical expiry and explicit declared checks. Both required reviews completed, all 28 confirmed findings corrected, source gate 138/138, and final-source native read/edit/check recovery verified. Release documentation/final-head checks and merge precede phase 4. Rewriting remains passthrough, evidence is resent, Jev disabled and no general saving or promotion is claimed. Evidence: [phase 0 validation](../validation/phase-0.md), [phase 1 validation](../validation/phase-1.md), [phase 2 validation](../validation/phase-2.md), [phase 3 validation](../validation/phase-3.md). Phase 4 remains pending.

**read_when:** Before implementing a phase, opening its PR, or resuming after compaction.

## Global Constraints

- Keep all source, tests, templates, versionable evaluation cases, plans, and documentation inside this independent repository's root. LifeOS is reference material, never a runtime dependency or payload destination.
- Filenames, identifiers, configuration keys, comments, and documentation prose must be English. Keep files below approximately 500 lines; apply `write-discoverable-code` to code writes.
- Preserve the current interface, main model, and effort. No custom App Server client, universal shell router, vector database, AI summaries, classifier training, or automatic subagent/model control.
- Each phase starts in a new feature branch and new worktree from verified, current `develop`; PR base is `develop`. Never implement in `main`, `develop`, or the original checkout.
- Use `$superpowers:test-driven-development` for every behavior and review correction: observe RED → minimum implementation → GREEN → refactor with GREEN. Import/syntax errors do not prove behavioral RED; only empty interface stubs may precede the failing assertion.
- Prefix commands with `rtk`. Use `rtk proxy` for tests, diagnostics, code, and exact diffs. Execute internal utilities with structured argv; never interpolate prompts, repository text, or Jev output as shell.
- Jev: one grouped query per eligible request, up to six questions; **1 second; zero retries**. A second ranking query is excluded unless a later, specific proposal demonstrates incremental savings.
- Complete preparation: **2 seconds**. Native handler timeout: **3 seconds**. The shared deadline covers child processes and network reads; expiration cancels preparation without accidental incomplete injection.
- Jev request state including questions: **6,000 UTF-8 bytes**. Hook context: **6,000 UTF-8 bytes** and handler `additionalContextLimit: 2000` approximate tokens; never change global tool limits.
- Routine first page: **8,000 UTF-8 bytes**, with identified omissions and continuation. Do not cut fragments or hunks. Local state/log retention: **7 days; private permissions**.
- Initial mode, absent configuration, and invalid configuration: `off`. `shadow` computes without injection/rewrite; `enforce` applies only current promotions. `jev_enabled: false` disables queries and reuse of Jev decisions.
- Credentials stay outside Git. Telemetry contains identifiers, hashes, timings, and metrics, never transcripts, full prompts, or code. Minimal recent-request state and sensitive evaluation cases remain separate, private stores.
- Optimizer uncertainty, failure, or unverifiable coverage falls back to `baseline`. Git, `rg`, and check failures remain visible; no repair query to another LLM.
- Each PR follows implementation → PR → first review/fixes → second review/fixes → stop reviews → documentation → protected merge → safe cleanup. Resolve every real finding, including minor findings.

## Review Focus

1. Uncommitted edits, new files, and compaction between reads must refresh evidence, never reuse lost references. Tests: 1A and 3A.
2. Exhaustive reviews and oversized hunks must retain the full inventory and explicit continuation, never imply complete coverage from a partial page. Test: 2A.
3. Unicode/space/newline paths, external symlinks, and read/hash races must preserve exact provenance and authorized roots. Test: 2A.
4. Concurrent sessions, duplicate usage events, and incomplete transcripts must isolate state and avoid double counting; missing measurement is unknown. Tests: 0B and 1A.
5. Structurally valid but contradictory/sensitive Jev responses and changed actual models must abstain and invalidate affected promotions. Tests: 1B and 4A.

## Verified Preparation and Prerequisites

Repository update, 2026-10-01: Roe requested removal of the parent Git metadata and initialization here. The repository root is now `/Users/mrz/Documents/Roe/tools/LifeOS/codex-token-efficiency`; the old `.git` is in Trash. The new repository initially had main only; Roe subsequently established develop and the authorized independent remote. Phase 0 starts from `f416fd89797281294c08e0062d95c5aeeba17880`. Do not reuse the former upstream or its SHA as this repository's base.

Historical read-only checks at the start of the planning session, 2026-09-30; these describe the former parent repository:

| Item | Evidence |
|---|---|
| Actual repository | `/Users/mrz/Documents/Roe/tools/LifeOS`, from `rtk proxy git rev-parse --show-toplevel` |
| Starting checkout | `main`, initially clean, four local commits ahead of `origin/main` |
| Observed SHA, **not an implementation base** | `fdab7e1f2f494e6c1a31892c896e5d0cc8469d22` |
| Current remote | `origin`: `https://github.com/danielmiessler/LifeOS` |
| `develop` | Missing locally; `rtk proxy git ls-remote --heads origin develop` returned no matches, exit 0 |
| Installed tools | Codex CLI `0.159.2`; Node `v24.13.0`; Git `2.54.0`; `rg` `15.2.0`; RTK `0.49.0` |
| Candidate usage source | Local `event_msg` → `token_count` → `info.total_token_usage` records, located without exposing conversations |
| Required review/documentation skills | Their exact AGENTS.md paths exist |

**Execution prerequisite, satisfied for phase 0:** Roe's intended develop branch and independent remote/write access were verified. Refresh and verify develop again before every subsequent phase; never import the former parent's history or substitute a base branch.

Before phase 0, ensure the selected `develop` makes the specification, instructions, and this plan available. If absent, transfer only explicitly authorized documentation, preserving unrelated commits. Installed CLI support does not prove hooks run in the current interface; 0A must establish that.

Contracts consulted: [Codex hooks](https://learn.chatgpt.com/docs/hooks) and [TypeSafe OpenAPI](https://api.typesafe.ai/openapi.json). Recheck at execution; real-client tests determine supported behavior.

## Files and Shared Contracts

Paths below are module-relative inside the implementation worktree. From the module cwd, do not create another nested `codex-token-efficiency/` directory.

| File | Responsibility and first phase |
|---|---|
| `src/codex-context-policy.mjs` | CLI/hook entry point, configuration, local facts, policy, and decisions; 0A/1A |
| `scripts/manage-context-policy.mjs` | Additive native registration, withdrawal, mode changes; 0A |
| `config/hooks.template.json`, `config/context-policy.template.json` | Native definitions and initial `off` configuration; 0A |
| `src/pilot-evaluation.mjs` | Versioned usage reading, corpus validation, paired comparisons, trial handler; 0B/2B |
| `scripts/verify-context-policy.mjs` | Syntax, behavioral tests, JSON, and local-document link gate; 0B |
| `evaluation/tasks.jsonl` | Versionable synthetic/deidentified cases and expected evidence/results; 0B |
| `src/context-state.mjs` | Session state, hashes, receipts, invalidation; 1A |
| `src/jev-client.mjs`, `config/jev-questions.json` | REST/response validation and explicit questions/criteria; 1B |
| `src/repository-context.mjs` | Selector and three reading operations; 2A |
| `skills/codex-context-operations/SKILL.md` | Operation contracts and expansion; never required for automatic preparation; 2A |
| `src/project-checks.mjs` | Declared-check discovery and requested execution; 3B |
| `tests/*.test.mjs` | Behavioral files specified by each task; no external test framework |
| `docs/validation/phase-N.md` | Starting SHA, environment, RED/GREEN, integration, reviews, outcomes |
| `docs/architecture.md`, `docs/usage.md`, `docs/evaluation.md`, `docs/RELEASING.md`, `CHANGELOG.md` | Proportional release documentation after both reviews |

Split only by the stated responsibilities or when a file approaches 500 lines. No provider framework, factories, generic utility/type files, or copying LifeOS helpers. JSDoc lives beside its owning function, with one definition per object.

- `ContextPolicyConfig`: `{mode:'off'|'shadow'|'enforce',jev_enabled:boolean,operations:Record<string,'off'|'shadow'|'enforce'>}`. Before operation settings exist, normalize them to an empty object.
- `TaskState`: specification §5 fields plus `recent_requests`, `protected_requirements`, `permissions_hash`, `corpus_hash`, `versions`, `updated_at`. `repo_revision` includes HEAD and relevant working-tree inventory/content hashes, including untracked task files.
- `DecisionRecord`: specification §5 fields; `operation` is a recognized local family, `source` ∈ `rule|jev|cache`, `action` ∈ `baseline|prefetch|reuse`; `applied` distinguishes a proposal from execution.
- `ContextBundle`: `status` ∈ `ok|error|stale`, `request_hash`, `repo_revision`, `context_epoch`, `entries`, `coverage_status` ∈ `partial|complete`, `omissions`, `omitted_count`, `next_cursor`, `full_result`, `exit_code`, `stderr`. Entry: `{path,start_line,end_line,content,sha256,protected}`; diff entries preserve exact hunk/header text. Underlying utility failures retain their exit code and diagnostic.
- `CodexHookInput`: `{hook_event_name,session_id,turn_id?,cwd,model,permission_mode?,prompt?,tool_name?,tool_input?,transcript_path?}`, validated per event. No shared fallback session ID. If child hooks reuse parent identity without a reliable distinguishing ID, abstain from child optimization rather than corrupt parent state.
- `ContextVersions`: `{client_version,jev_model,questions_hash,policy_hash}` plus observed configuration revision and requested-model binding; `jev_model` is the actual executed model for that decision, nullable when no provider model is observed. Stable task `expected_jev_model` is separate, survives local turns, resets on explicitly selected alias changes and honors admitted actual pins. Hybrid fingerprints include Jev/model/questions; deterministic promotions do not depend on irrelevant Jev fields.
- `PilotRun`: `{task_id,conversation_id,family,variant,model,effort,initial_revision,versions,order,cache_condition,correct,checks_passed,required_evidence,delivered_evidence,omissions,corrections,duration_ms,usage_by_provider,cost_by_provider}`. Missing usage/cost is `null`, never zero.
- Promotion record: `{family,variant,versions,corpus_hash,thresholds,report_hash,promoted_at}`. A config flag alone cannot constitute a promotion.

Operation CLI: `rtk proxy node src/codex-context-policy.mjs <operation>`, one JSON request on stdin. Hook argument: literal `hook`; expansion: `read_context`. The skill provides exact request and executable command examples; explicit-operation stdout is structured protocol only, with diagnostics inside JSON and no duplicate stderr preview; hook/setup channels keep their own contracts. External runtime registration/configuration/state are installed locations, never extra source copies.

## Required Opening of Every Phase

Repeat for N = 0–4; begin N+1 after N merges and closes. Read `superpowers:using-git-worktrees` when creating the implementation worktree.

- [ ] Resolve root with `rtk proxy git rev-parse --show-toplevel`; inspect `rtk proxy git status --short --branch` and `rtk proxy git worktree list --porcelain`. Preserve others' work; no manual stash or original-checkout branch switch.
- [ ] Verify authorized remote and `rtk proxy git ls-remote --heads origin develop`. Missing remote develop stops implementation.
- [ ] Run `rtk proxy git fetch origin develop` and verify `origin/develop`. If only the local branch is absent, `rtk proxy git branch --track develop origin/develop`.
- [ ] Update local develop by fast-forward only: `rtk proxy git fetch origin develop:develop` when not checked out, or `rtk proxy git merge --ff-only origin/develop` from its clean checkout. Divergence/rejection stops without forcing.
- [ ] Verify `rtk proxy git rev-list --left-right --count develop...origin/develop` → `0 0`; record `rtk proxy git rev-parse develop` as `starting_develop_sha`.
- [ ] From repository root, create `rtk proxy git worktree add -b feat/codex-token-efficiency-phase-N ../codex-token-efficiency-worktrees/phase-N develop`, replacing N with the phase number. Use a new, free path and branch. Sibling LifeOS reference paths resolve from the primary checkout as described in AGENTS.md, not from this temporary worktree.
- [ ] In that worktree, verify HEAD equals the recorded SHA, feature branch, and actual root. Before implementation, create module `docs/validation/phase-N.md` with starting SHA, actual path, feature branch, remote, `pr_base: develop`, selected execution method, and versions.
- [ ] Record baseline: before the gate exists, inventory/tools; from 0B onward, `rtk proxy node scripts/verify-context-policy.mjs` → exit 0. Record existing failures separately.

## Phase 0 — Compatibility and Baseline

Branch `feat/codex-token-efficiency-phase-0`. Deliver installation in off, actual hook coverage, versioned measurement, and corpus. R1/R7. No Jev or optimizer changes applied.

### Task 0A: Minimal Hook and Reversible Installation

**Files:** Create `src/codex-context-policy.mjs`, `scripts/manage-context-policy.mjs`, both templates, and `tests/hook-installation.test.mjs`. Record `docs/validation/phase-0.md`.

**Interfaces:** Produce `readContextPolicyConfig(repoRoot: string): Promise<ContextPolicyConfig>`; `handleCodexHook(input: CodexHookInput): Promise<{stdout:string,stderr:string,exit_code:number}>`; `updateContextPolicyInstall({repo_root:string,source_root:string,action:'install'|'remove',apply:boolean}): Promise<{changed:boolean,files:string[],error:string|null}>`. Management CLI: `install|remove --repo <path> --source <module-path> [--apply]`; default is a reviewable dry-run.

- [x] **RED: `off_and_additive_install`.** Temporary repo with an existing write guard: install twice, then remove; preserve foreign entries/order and other configuration. Existing malformed JSON is rejected without byte changes. Missing/invalid config is off; off performs no network, Git, or rg work.
  ```js
  assert.deepEqual(afterRemoval.hooks, original.hooks);
  assert.equal(secondInstall.changed, false);
  assert.deepEqual(await handleCodexHook(offInput), {stdout: '', stderr: '', exit_code: 0});
  ```
- [x] **Observe RED:** `rtk proxy node --test --test-name-pattern='off_and_additive_install' tests/hook-installation.test.mjs` → behavioral assertion failure; record the exact failure.
- [x] **Implement:** read config on every invocation; template `{"mode":"off","jev_enabled":true}`. Register UserPromptSubmit, PreToolUse for Bash, observational PostToolUse, PostCompact, and SessionStart/End only where client coverage is verified. Handler timeout 3; context limit 2000. Quote absolute Node/source paths safely; atomic writes and pre-write comparison preserve concurrent changes. Identify only owned entries; never bypass or fabricate native hook trust.
- [x] **GREEN and real integration:** repeat test → PASS. Management dry-run shows the delta; trial installation undergoes native trust in the current interface. Record a synthetic pre-prompt marker, direct/nested calls, local/hosted MCP coverage, persistent commands, compaction, and resume. Marker belongs only to the compatibility test. Matrix: `supported|unsupported|unverified`; unsupported/unverified paths remain disabled. CLI support/version alone is insufficient.
- [x] **Commit:** stage only this task's files; `feat: add project Codex hook registration in off mode`. Detailed body: verified contract, hook preservation, tests, outstanding coverage.

### Task 0B: Real Usage, Evaluation Corpus, and Gate

**Files:** Create `src/pilot-evaluation.mjs`, `evaluation/tasks.jsonl`, `scripts/verify-context-policy.mjs`, `tests/pilot-evaluation.test.mjs`; complete phase evidence.

**Interfaces:** Consume the observed source from 0A. Produce `collectCodexUsage(events: object[], clientVersion: string): {available:boolean,input_tokens:number|null,cached_input_tokens:number|null,cache_write_input_tokens:number|null,output_tokens:number|null,reasoning_output_tokens:number|null,total_tokens:number|null}` and `validatePilotCorpus(tasks: object[]): {valid:boolean,errors:string[]}`. Each normalized event carries source thread/session and counter epoch. CLI: `rtk proxy node src/pilot-evaluation.mjs usage --transcript <path> --client-version <version>`; `corpus --tasks evaluation/tasks.jsonl`.

- [x] **RED: `usage_totals_and_corpus`.** Cumulative 100, duplicate 100, 150 → 150. Output 20 including reasoning 5 → 20, not 25. Separate workers/threads and verified counter resets; trailing incomplete line is recoverable, unsupported/corrupt usage is unknown with diagnostics. Reject a conversation appearing in both tuning and held-out sets.
  ```js
  assert.equal(collectCodexUsage(events, '0.159.2').total_tokens, 150);
  assert.equal(collectCodexUsage(events, 'unknown').available, false);
  assert.equal(validatePilotCorpus(overlappingConversations).valid, false);
  ```
- [x] **Observe RED:** `rtk proxy node --test --test-name-pattern='usage_totals_and_corpus' tests/pilot-evaluation.test.mjs` → assertion failure for totals, version, or split.
- [x] **Implement:** read-only adapter limited to observed version/shape; local `event_msg/token_count/info.total_token_usage` is a candidate, not a universal contract. Read usage/identity without exporting transcripts. Deduplicate cumulative counters per thread, add verified reset epochs, never convert unknown to zero. No extra server. Gate runs node --check on .mjs, node --test, JSON/JSONL parsing, relative-document links, and source-scope checks. External linter/typechecker are not applicable without existing configuration; do not add dependencies to simulate them.
- [x] **GREEN and baseline:** tests PASS; gate exit 0. Create **60 held-out tasks**: 10 each for code analysis, review, documentation, checks, short follow-ups, and exhaustive requests; include large repos and indirect dependencies. Add tuning conversations separately. Each case fixes initial revision, deidentified prompt, expected checks, required evidence, and verifiable outcome. Sensitive real cases stay private/local. Validate actual-interface task totals including workers; incomplete measurement permits indicators, not promotion.
- [x] **Commit:** `feat: add versioned Codex usage measurement and pilot cases`. Complete phase 0's PR lifecycle before phase 1.

## Phase 1 — Rules and Jev in Shadow

Branch `feat/codex-token-efficiency-phase-1`. Deliver isolated task state, minimal rules, validated Jev REST, and calibrated observation. R3/R6/R7.

### Task 1A: State, Continuity, and Deterministic Decisions

**Files:** Create `src/context-state.mjs` and `tests/context-state.test.mjs`; modify policy and `tests/hook-installation.test.mjs`.

**Interfaces:** Consume 0A/shared objects. Produce `captureContextTask(input: CodexHookInput, previous: TaskState|null): Promise<TaskState>`; `saveContextTask(stateDir: string, state: TaskState): Promise<boolean>`; `resolveContextDecision(state: TaskState, facts: object, jevResponse: object|null): DecisionRecord`. Facts: `{explicit_paths,literal_symbols,change_scope,exhaustive,known_operation,inventory_hash}`.

- [x] **RED: `state_isolation_and_continuity`.** Parallel repositories/sessions remain separate; overlapping writers do not erase constraints. Uncommitted edit and new untracked file change revision. Known “hazlo” continuation preserves objective/exhaustiveness; uncertain continuation is baseline. Permissions/corpus changes invalidate reuse; unknown child identity cannot alter parent state.
  ```js
  assert.notEqual(beforeEdit.repo_revision, afterEdit.repo_revision);
  assert.deepEqual(followup.protected_requirements, previous.protected_requirements);
  assert.equal(unknownFollowupDecision.action, 'baseline');
  ```
- [x] **Observe RED:** `rtk proxy node --test --test-name-pattern='state_isolation_and_continuity' tests/context-state.test.mjs` → isolation/revision/continuity assertion failure.
- [x] **Implement:** hash real repository/session identity below `~/.codex/codex-context-policy/`; directories 0700, files 0600, atomic replacement, exclusive short session lock. Conflict/corruption abstains without waiting; immutable independent decision files. Refresh inventory each turn; SHA-256 relevant content, no external symlink traversal. Expire only owned state/logs older than seven days. Recognize explicit paths/symbols/scope, never difficulty from message length. Shadow stores metadata/hashes and `applied:false`, no injection/rewrite.
- [x] **GREEN:** tests/gate PASS. Exercise two real sessions and config changes between invocations; inspect sanitized telemetry and minimal private recent-request state. Inventory errors preserve diagnostics, never become empty results.
- [x] **Commit:** `feat: track isolated context state and deterministic shadow decisions`; body records isolation, invalidation, and tested continuity.

### Task 1B: Bounded Jev Contract and Abstention

**Files:** Create `src/jev-client.mjs`, `config/jev-questions.json`, `tests/jev-client.test.mjs`; modify policy/evaluation.

**Interfaces:** Produce `queryJevContext(request: {model:string,state:object,questions:object}, options: {apiKey:string|null,fetchImpl:typeof fetch,signal:AbortSignal}): Promise<{status:'ok'|'abstain',response:object|null,fallback_reason:string|null,duration_ms:number}>`. Consume `resolveContextDecision`. Discover model with GET /v1/models during setup, outside the critical path; chosen model is private operational configuration. Roe's 2026-10-01 installation request extends credential setup: prefer `TYPESAFE_API_KEY`, otherwise read the user's macOS Keychain entry; no credential appears in hook JSON, argv, Git, or telemetry.

- [x] **RED: `jev_contract_and_abstention`.** Local fake server/fetch covers success, broken JSON, missing answer, wrong types, nonfinite/out-of-range probability, incoherent distribution, unknown label, negative usage, 401/429/5xx, timeout, and contradictions. Oversized/sensitive state, conclusive rules, off, and disabled Jev make zero requests. Eligible request makes at most one POST, no retries.
  ```js
  assert.equal(incomplete.status, 'abstain');
  assert.equal(timeoutCalls, 1);
  assert.equal(disabledCalls, 0);
  assert.equal(contradictoryDecision.action, 'baseline');
  ```
- [x] **Observe RED:** `rtk proxy node --test --test-name-pattern='jev_contract_and_abstention' tests/jev-client.test.mjs` → validation/abstention/call-count assertion failure.
- [x] **Implement:** POST `https://api.typesafe.ai/v1/systemone` with fetch/Bearer, redirect rejection, and cancellation within 1000 ms/shared 2000 ms deadline. Validate full response: named question/answer objects; noul has `{type:'noul',noul:number}`, no confidence; choice has `{type:'choice',choice,confidence,probabilities}`. Exact recognized keys, finite [0,1] values, probability sum within documented 1e-6 rounding tolerance, selected maximum, nonnegative integer usage, actual model. Minimize state before querying: no code/full conversation, known-secret filtering, abstain if safe minimization is uncertain. No generated paths/commands or removal of constraints.
- [x] **GREEN/calibration experiment:** tests/gate PASS. Freeze §6's six IDs, labels and choice criteria before separate tuning/held-out observations; test threshold 0.90 and choice margin 0.20. Noul yes/no uses p≥threshold or p≤1−threshold; intermediate values abstain. Actual inference/model/usage recorded after Roe's local credential setup. No semantic proposal passed, so per-family activation thresholds and utility remain unsupported; keep Jev disabled and all six questions experimental. Corrected recorded-response replay: 19 correct local proposals/60, zero wrong/semantic, not a fresh independent held-out sample. One earlier lost usage record leaves exact billing unknown. Hybrid evaluation remains incomplete; deterministic shadow behavior is available.
- [x] **Installer credential extension (Roe requested 2026-10-01):** Create `src/context-credentials.mjs` and `tests/context-credentials.test.mjs`; modify manager/policy. `readJevCredential(signal?:AbortSignal, preferEnvironment?:boolean):Promise<string|null>` prefers the environment, then bounded macOS `security find-generic-password` output captured only in memory. `configureJevCredential():Promise<string>` runs native `security add-generic-password` with `-w` last, prompting locally without placing the key in argv. The fixed user Keychain service is shared by opted-in installations; per-project policy and native trust still control queries. Installer `install --configure-jev --apply` requires an interactive terminal, performs discovered-model setup, and reports only safe status/model metadata. Noninteractive/dry-run/removal paths cannot prompt or mutate credentials. RED covers environment precedence, missing/failed native lookup, cancellation, no secret in command arguments/output, and noninteractive installation preserving registrations. GREEN gate passed; Roe completed native credential setup and authenticated discovery. Existing phase 1 worktree/base and the exact two-review lifecycle remain unchanged.
- [x] **Commit:** `feat: classify bounded context decisions with Jev in shadow mode`, plus confirmed review fixes through `1614195`; complete release documentation/final checks/merge before phase 2.

**Phase 1 review/retention result:** both prescribed stages completed, all real findings resolved. First-stage coverage complete/convergence false at three cycles; second full-range review's selected-alias/explicit-pin transitions fixed through separate RED→GREEN owner regressions. Source gate 76/76. Seven-day logical expiry is enforced; physical cleanup is opportunistic within 25 ms during enabled activity, with no off/idle deletion or traversal-progress guarantee. No further independent review; documentation uses the required override.

## Phase 2 — Evidence Selection and Pre-Prompt Preparation

Branch `feat/codex-token-efficiency-phase-2`. Deliver protected exact retrieval, progressive reads, automatic pre-generation preparation, and the first paired experiment. R2/R4/R5.

### Task 2A: Three Read Operations and Protected Evidence

**Files:** Create `src/repository-context.mjs`, `tests/repository-context.test.mjs`, `skills/codex-context-operations/SKILL.md`; modify CLI/policy and installer tests.

**Interfaces:** Produce `selectCodeContext({repo_root,request_hash,repo_revision,context_epoch,paths,symbols,family,scope,exhaustive,byte_limit,signal}): Promise<ContextBundle>`; `getRepositoryChanges({repo_root,request_hash,repo_revision,context_epoch,scope,cursor,byte_limit,signal}): Promise<ContextBundle>`; `readContext({repo_root,state_dir,session_id,reference,cursor,byte_limit,signal}): Promise<ContextBundle>`. Scope: `{kind:'worktree'}` or `{kind:'range',base:string,head:string}`; family: `code_context|code_review_context|documentation_context`. Use typed JSDoc for each parameter from these fields; defaults are 6000 preparation/8000 routine bytes.

- [x] **RED: `protected_evidence_and_exact_pages`.** Temporary mini-repo has staged/unstaged/new/renamed/deleted files, a caller, direct dependency, tests/docs/instructions. Low ranking never removes protected evidence. Exhaustive pages reconstruct all matches. Oversized hunk remains fully retrievable. Unicode/space/newline paths are exact; outside symlink and concurrent read/hash edit return error/stale without outside reads. Git/rg errors retain diagnostics.
  ```js
  assert.ok(bundle.entries.some(e => e.path === 'src/caller.mjs' && e.protected));
  assert.equal(bundle.coverage_status, 'partial');
  assert.deepEqual(recoveredMatches, allExpectedMatches);
  assert.equal(outsideSymlink.status, 'error');
  ```
- [x] **Observe RED:** `rtk proxy node --test --test-name-pattern='protected_evidence_and_exact_pages' tests/repository-context.test.mjs` → coverage/exactness/root assertion failure.
- [x] **Implement:** git ls-files -z plus relevant untracked files; status --porcelain=v1 -z; exact scope inventory/diffs; literal rg -F with --json. rg exit 1 means no matches, other failures remain errors. Disable external diff/textconv; validate range commits and use -- separators. Explicit ignored paths remain discoverable. Protect explicit files/symbols, full review change inventory, found callers/direct dependencies, necessary tests/config/instructions, and exhaustive matches. Rank only optional evidence by verified match/proximity, stable order; textual references are not a complete dependency graph.
- [x] **GREEN/expansion/skill:** tests/gate PASS. Whole fragments carry path/lines/hash; cursor/result references bind repository/session/revision/epoch and never expose arbitrary runtime paths. Revalidate hashes/roots when expanding. Oversized units return inventory/omission plus explicit whole-unit retrieval; no endless empty pages. Binary/non-UTF8 evidence gets inventory and exact separate retrieval, never destructive decoding. Unresolved/dynamic references remain partial with broader exploration. Unsafe representation abstains. Keep the skill brief; native registration may use an owned `<repo>/.agents/skills/codex-context-operations` symlink to module source, never a source copy. Preserve collisions/foreign entries and test removal; checks are still unavailable.
- [x] **Commit:** `feat: select protected repository evidence with exact continuation`.

### Task 2B: Automatic Injection and Context Experiment

**Files:** Modify policy/evaluator/manager/config template; create `tests/context-prefetch.test.mjs`; extend `tests/pilot-evaluation.test.mjs`.

**Interfaces:** Produce `prepareCodexContext(state: TaskState, decision: DecisionRecord, versions: ContextVersions): Promise<ContextBundle|null>`; introduce `comparePilotRuns(runs: PilotRun[]): {families:object[],promotions:object[],limitations:string[]}` and `resolveContextPromotion(config: ContextPolicyConfig, family: string, versions: ContextVersions, report: object|null): 'off'|'shadow'|'deterministic'|'hybrid'` for the three context families. Introduce evaluator `report --runs <private-run-jsonl> --tasks evaluation/tasks.jsonl` and manager `promote --repo <pilot> --report <report> --family <family> --variant deterministic|hybrid [--apply]` for these families. 4A extends the same functions/commands, not a second implementation. Hook output: `hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:string}`.

- [x] **RED: `automatic_context_budget_and_modes`.** Explicit path triggers preparation without skill selection. Shadow/unpromoted family emits nothing. Shared timeout discards incomplete proposal. UTF8 byte accounting never cuts protected evidence. Review recipe includes changes+selector, documentation recipe includes docs; baseline/contradiction does no preparation. Missing usage or quality regression cannot grant the first context promotion. The trial handler rejects unknown corpus cases, roots, prompt hashes, models, and revisions without injection.
  ```js
  assert.equal(shadow.stdout, '');
  assert.ok(Buffer.byteLength(enforcedContext, 'utf8') <= 6000);
  assert.equal(timedOutBundle, null);
  assert.equal(knownRequestPreparationCalls, 1);
  assert.equal(unmeasuredComparison.promotions.length, 0);
  assert.equal(invalidTrial.stdout, '');
  ```
- [x] **Observe RED:** `rtk proxy node --test --test-name-pattern='automatic_context_budget_and_modes' tests/context-prefetch.test.mjs` → automatic-work/mode/budget/promotion assertion failure.
- [x] **Implement:** UserPromptSubmit → facts → eligible Jev → recipe → exact bundle with one deadline from entry. Cancel children/fetch at expiration; no project writes, checks, or installs during prefetch. Present file contents as provenance-bearing data, never optimizer instructions; preserve native instruction loading. Add per-context-family settings and versioned promotion validation now, using the same quality/token/latency criteria listed in 4A. The manager recomputes eligibility from report data and atomically persists only valid private promotion records; mismatches abstain. Shadow's proposed content lives privately apart from telemetry.
- [x] **GREEN/integration:** tests/gate PASS. Current interface receives evidence before generation; expansion/errors work with unchanged model/effort. Test 2000 approximate-token limit with Unicode for unexpected spill; document effective behavior and remove whole optional entries or abstain. No reusable receipt without verified delivery.
- [x] **Paired trial:** evaluator CLI `trial --tasks evaluation/tasks.jsonl --task <id> --variant baseline|deterministic|hybrid --repo <trial-root>` is a temporary native-hook handler restricted to a declared corpus task, matching prompt hash, model, and initial revision. It executes the same preparation functions in isolated trial repositories and includes its full latency/provider usage. Baseline injects nothing; alternatives deliver experimental evidence before generation. Native trust still applies; the handler never authorizes production enforce or replaces the interface. Record separate sessions with identical model/effort/prompt/state, order/cache controls, all reads/corrections/tokens. Shadow decisions alone are not savings evidence. First context promotion must pass 4A criteria; otherwise keep shadow.
- [x] **Commit:** `feat: prepare bounded context before Codex generation`; complete phase 2 lifecycle with measured results/limits.

## Phase 3 — Deduplication, Wrappers, and Known Checks

Branch `feat/codex-token-efficiency-phase-3`. Deliver measured incremental savings with current references and preserved errors/permissions. R4/R5/R6.

### Task 3A: Receipts, Invalidation, and Recoverable Results

**Files:** Modify state/recovery/policy; create `tests/context-reuse.test.mjs`.

**Interfaces:** Consume bundles/state. Produce `reuseContextDelivery(bundle: ContextBundle, receipt: object|null, state: TaskState): {action:'reuse'|'prefetch',reference:string|null}`. Private receipt: `{bundle_hash,session_id,turn_id,context_epoch,request_hash,repo_revision,corpus_hash,permissions_hash,versions,delivery_confirmed}`. `readContext` retrieves full results by validated reference.

- [x] **RED: `reuse_requires_current_delivery`.** Confirmed identical content/epoch permits reference. Edit, new candidate/file, corpus/permission/version/objective change, compaction, or uncertain resume requires fresh content. Prompt hash alone is insufficient. Without delivery confirmation, resend; repeated arbitrary tools are never blocked.
  ```js
  assert.equal(reuseContextDelivery(bundle, receipt, current).action, 'reuse');
  assert.equal(reuseContextDelivery(bundle, receipt, compacted).action, 'prefetch');
  assert.equal(reuseContextDelivery(bundle, null, current).reference, null);
  ```
- [x] **Observe RED:** `rtk proxy node --test --test-name-pattern='reuse_requires_current_delivery' tests/context-reuse.test.mjs` → freshness/delivery assertion failure.
- [x] **Implement:** cache key includes request/task/corpus/permissions/actual Jev/questions/policy/content; invalidate conservatively when events are unavailable. Receipt follows verified delivery, never mere preparation. Without reliable context-availability signals, deduplicate internal work only and resend evidence. Wrapper envelope preserves status/exit/error, omissions, cursor, and private full result; 8000-byte routine pages use whole units.
- [x] **GREEN:** 138-test gate and final-source real session read → edit → reread → check → recover pass. Expanded evidence remains exact. Native compact/resume availability remains unverified, so evidence is always resent. Component storage comparison establishes fewer artifacts/writes, not native token or latency saving.
- [x] **Commit:** `feat: reuse confirmed context with explicit invalidation and full results`.

### Task 3B: Execute Only Declared Project Checks

**Files:** Create `src/project-checks.mjs` and `tests/project-checks.test.mjs`; modify CLI/skill/policy.

**Interfaces:** Produce `detectDeclaredChecks(repoRoot: string): Promise<Array<{name:string,command:string,args:string[]}>>`; `runProjectChecks({repo_root:string,checks:string[],signal:AbortSignal}): Promise<Array<{name,exit_code,stdout,stderr,status,omitted_count,next_cursor,full_result}>>`. Operation `run_project_checks` is explicitly requested through ordinary Codex tool permissions, never prompt preparation.

- [x] **RED: `declared_checks_preserve_failure`.** Existing scripts and compatible declared PM/lockfile are recognized; unknown check/conflicting PM executes nothing. Long failure preserves exit 7, stderr, and full retrieval. Empty stdout plus exit 7 is error, never success. Timeout/cancellation/permission denial is not PASS; prefetch never executes checks.
  ```js
  assert.equal(failed.exit_code, 7);
  assert.equal(emptyFailure.status, 'error');
  assert.equal(unknownCheckExecutions, 0);
  ```
- [x] **Observe RED:** `rtk proxy node --test --test-name-pattern='declared_checks_preserve_failure' tests/project-checks.test.mjs` → permission/diagnostic/exit assertion failure.
- [x] **Implement:** use real package.json scripts and the module's documented gate declaration; do not interpret README prose as arbitrary shell or guess checks from extensions. Execute installed project PM via argv/cwd without installs. Do not filter failure evidence with RTK. Preserve full private stdout/stderr; passing checks may summarize, failures retain diagnosis and continuation. Denial returns its reason without changing permission policy.
- [x] **GREEN:** tests/gate PASS; real failing trial check reaches Codex with intact exit/diagnosis. Document unsupported check formats. Evaluate semantics and permission preservation before promotion.
- [x] **Commit:** `feat: run declared project checks without hiding failures`.

### Task 3C: Limited Local Command Rewrite

**Files:** Modify policy; create `tests/tool-rewrite.test.mjs`; update native template only if definitions change.

**Interfaces:** Produce `rewriteContextCommand(command: string): string|null`; `handleCodexHook` changes only command, preserving tool_input fields, using `permissionDecision:'allow'` plus `updatedInput`. Never change tool name or make PermissionRequest decisions.

- [x] **RED: `simple_rewrite_preserves_semantics`.** Initial candidates: git status, git status --short, git status --short --branch. Admit only real-client RTK equivalence for inventory/exit/errors. Pipe, redirects, heredoc, newline, &&, semicolon, substitution, backticks, env prefix, quoting, MCP, unknown flag, or existing RTK returns no rewrite. Off/shadow/unpromoted also remain unchanged.
  ```js
  assert.equal(rewriteContextCommand('git status | cat'), null);
  assert.equal(rewriteContextCommand('git diff'), null);
  assert.equal(updatedInput.cwd, originalInput.cwd);
  ```
- [x] **Observe RED:** `rtk proxy node --test --test-name-pattern='simple_rewrite_preserves_semantics' tests/tool-rewrite.test.mjs` → passthrough/argument-preservation assertion failure.
- [x] **Implement:** literal recognition of verified forms, no universal parser; check RTK availability. Remove any candidate lacking equivalence. Exact evidence reads/diffs/show remain unchanged or use proxy where appropriate; no PostToolUse replacement. Native denies and existing write guards must still win.
- [x] **GREEN/integration:** tests/gate PASS; direct/nested/persistent/MCP inputs and PermissionRequest passthrough are verified locally. No candidate has actual native permission/error equivalence, so all candidates remain disabled. No active native rewrite or saving is claimed.
- [x] **Commit:** `feat: rewrite only verified simple local status commands`; complete phase 3 lifecycle with incremental measurements.

**Phase 3 result:** the prescribed conservative branch is delivered: internal exact storage reuse, explicit recoverable checks and no command rewrite. Both review stages and every confirmed TDD correction completed in source `af35956`; final-source native smoke passes. See [phase 3 validation](../validation/phase-3.md). Native confirmed availability, compaction and active rewrite remain unverified, so their optimization is disabled. Required release documentation/final gate and normal merge precede phase 4.

## Phase 4 — Final Evaluation and Gradual Activation

Branch `feat/codex-token-efficiency-phase-4`. Deliver family-level report/promotions and tested off/uninstall. R8 and complete R1–R8 coverage.

### Task 4A: Promotion Criteria, Switches, and Pilot Report

**Files:** Modify evaluator/policy/manager/config/skill; extend `tests/pilot-evaluation.test.mjs` and `tests/hook-installation.test.mjs`; create `tests/context-promotion.test.mjs`. Release docs follow both reviews.

**Interfaces:** Extend existing `comparePilotRuns`, `resolveContextPromotion`, and the report/promote commands from 2B for all known families. Produce `setContextPolicyMode(repoRoot: string, mode:'off'|'shadow'|'enforce'): Promise<{changed:boolean,error:string|null}>`. Evaluator reports remain auditable; promotion always validates report data and the applicable version fingerprint before private persistence.

- [ ] **RED: `promotion_requires_quality_and_measured_savings`.** Mandatory omission/critical regression/missing check blocks. Unknown usage, incorrect task, or mismatched versions cannot grant promotion. Exact bounds: 20% median saving passes if all others pass, 19% fails; p95 +1000 ms passes, +1001 ms fails. Actual Jev-model/questions changes invalidate hybrid; client/policy changes invalidate affected variants. Disabled Jev ignores cached semantic decisions while independent deterministic promotions survive.
  ```js
  assert.equal(resolveContextPromotion(config, family, changedJevVersion, hybridReport), 'shadow');
  assert.equal(insufficientSavings.promotions.length, 0);
  assert.equal(missingUsage.promotions.length, 0);
  assert.equal(validDeterministicPromotion, 'deterministic');
  ```
- [ ] **Observe RED:** `rtk proxy node --test --test-name-pattern='promotion_requires_quality_and_measured_savings' tests/context-promotion.test.mjs` → criterion/version/mode assertion failure.
- [ ] **Implement:** operation families: code_context, code_review_context, documentation_context, get_repository_changes, read_context, run_project_checks, rewrite_simple_command. Each setting off|shadow|enforce, absent = shadow; global mode caps every family. Re-read configuration per call. Off affects the next invocation without restart, cannot cancel an already sent query or remove existing conversation evidence. Separate deterministic/hybrid promotion fingerprints. If hybrid adds no demonstrated value, deterministic remains active and Jev observation stays outside the active critical path.
- [ ] **GREEN/final evaluation:** tests/gate PASS. Run all 60 held-out tasks in three paired variants: at least 180 executions, plus separate tuning and repeated variable cases. Rotate order/control cache; identical main model/effort/scope/state. Per family: no critical regression or required-evidence omission; resolution/check completion ≥ baseline; median paired total-token reduction per correct task ≥20%; median latency does not increase; p95 task duration increases ≤1000 ms. Report failed tasks rather than excluding them silently. Include Codex/Jev/workers, expansion/corrections, cache, reasoning without double counting, and provider costs without invented subscription pricing. Hybrid needs demonstrated incremental benefit over deterministic, accounting for query cost/latency; insufficient evidence cannot promote it. Report sample sizes/dispersion/exclusions/order/cache and add cases if family evidence is insufficient.
- [ ] **Withdrawal integration:** activate a qualified family, leave unpromoted families unchanged, disable Jev, switch off, then uninstall preserving other hooks/owned skill registration. New conversation verifies clean baseline. CLI `rtk proxy node scripts/manage-context-policy.mjs mode off --repo <pilot>` atomically changes only mode; removal first dry-runs then applies. No savings claim without real measurements.
- [ ] **Commit:** `feat: gate context activation on pilot evidence and versioned promotions`; close phase 4 through the lifecycle below.

## Required PR Closeout, in Order

Apply the entire sequence to every phase. Read each exact skill only when its stage arrives. Record evidence in module `docs/validation/phase-N.md` and the PR; pre-release execution notes do not initiate another review.

1. [ ] **Complete implementation/checks:** project gate, suite, phase integration, and RED/GREEN for every behavior. Resolve failures. Tests default to isolated trial repos without paid network/credentials. Stage explicit paths, excluding runtime data/ephemera. Conventional commits with detailed problem, behavior, contract, validation, and limitation bodies.
2. [ ] **Push and PR to develop:** verify remote/branch; `rtk proxy git push -u origin feat/codex-token-efficiency-phase-N`. Write exact multiline body to a temporary file; `rtk proxy gh pr create --base develop --head feat/codex-token-efficiency-phase-N --title '<phase title>' --body-file <file>`. Include scope/phase, plan, starting SHA, validation, limitations, pending docs. Verify actual base/head with `rtk proxy gh pr view --json number,baseRefName,headRefName,headRefOid`.
3. [ ] **First review `$review`:** read `/Users/mrz/Documents/keldai/tools/gstack/.agents/skills/gstack-review/SKILL.md`; review PR against develop via gh pr view/diff. Retain its internal fix verification. Resolve every real finding with TDD; record false positives with source/test evidence. After the skill returns, commit/push corrections to the same PR and record stage completion.
4. [ ] **Second review `$superpowers:requesting-code-review`:** read `/Users/mrz/.codex/plugins/cache/superpowers-dev/superpowers/6.4.2/skills/requesting-code-review/SKILL.md`. Fetch develop; obtain `rtk proxy git merge-base origin/develop HEAD` and `rtk proxy git rev-parse HEAD`. Dispatch a fresh reviewer with the complete range, specification, and plan, never just the last commit. Missing reviewer coverage is not approval. Fix all confirmed findings, including minor, through TDD/checks; substantiate false positives. Commit/push to the same PR and wait for reviewer completion.
5. [ ] **Stop reviews:** record both stages and all finding dispositions. No renewed reviewers or independent task/branch/code/documentation review. Continue tests/CI/document validation only; project override controls extra execution-skill review gates.
6. [ ] **Document with `$document-release`:** read `/Users/mrz/Documents/keldai/tools/gstack/.agents/skills/gstack-document-release/SKILL.md`. Skip independent cross-model/native-fallback documentation reviewers under AGENTS.md; perform normal documentation audit, updates, and validation. Maintain module README, usage/config, architecture, evaluation, release notes, RELEASING, and read_when hints proportionally to actual changes. Include coverage/usage source versions, real results, limitations, abstention, off/uninstall, installed paths. Update PR docs section via body-file; commit/push docs to the same branch.
7. [ ] **Final gate and protected merge:** `rtk proxy node scripts/verify-context-policy.mjs` → 0; required `rtk proxy gh pr checks` and `rtk proxy gh run list/view` green on the final head. Verify allowed merge method and branch protections; merge into develop without bypass. If base sync is required, synchronize without force, preserve work, and rerun checks. If protection requires a third review, report the workflow incompatibility rather than bypassing it. Confirm merged/base/SHA via gh pr view. Where applicable, thank the contributor in CHANGELOG before merge.
8. [ ] **Safe cleanup checks:** verify preservation in develop and empty `rtk proxy git status --porcelain=v1 --untracked-files=all` in the worktree. Check active processes and local/global native hook/skill registrations still referring to it. Remove trial registrations; move an active integration only to a stable checkout containing merged code, through additive installation/native trust. No stable destination or pending trust means retain the worktree and report why.
9. [ ] **Remove preserved resources only:** from another cwd, `rtk proxy git worktree remove <worktree>` without force. `rtk proxy git branch -d <feature>` only when Git confirms preservation; squash may prevent this, so retain it rather than using -D. Remove remote feature only after verifying merged PR, no subsequent commits, and no pending use: `rtk proxy git push origin --delete <feature>`. Never delete develop/unrelated branches; refusal means retain/report.
10. [ ] **Next phase:** safely refresh develop and record its new SHA; create a new feature/worktree. Missing exit criteria remain explicit; do not declare completion or substitute interface/model.

## Gate and Exit Criteria

From the module inside the implementation worktree, `rtk proxy node scripts/verify-context-policy.mjs` runs syntax, tests, JSON/corpus checks, and document links. Exit 0 plus explicit check results is required; empty output alone is insufficient. Existing repository CI is also required; never edit outside-module workflows to bypass failures. Real-client integration/usage must be recorded separately; unit tests cannot establish them.

| Phase | Observable exit | When missing |
|---|---|---|
| 0 | Current-interface hooks/coverage, additive trust, actual usage source, valid corpus | Disable affected path; no token promotion/claims without measured usage |
| 1 | REST/fallback/deadline tests and calibrated held-out decisions | Without credential/authorization, deterministic remains available; hybrid incomplete |
| 2 | Exact protected expandable context before generation, favorable paired comparison | Keep shadow; do not reduce requested coverage to manufacture savings |
| 3 | Current dedup, equivalent wrappers/errors/permissions, incremental benefit | Disable optimization with insufficient delivery/equivalence evidence |
| 4 | Family report meeting criteria, current versions, off/uninstall verified | Only evidenced families activate; others shadow/off |

Traceability: R1 → 0A/2B; R2 → 2B; R3 → 1A/1B; R4 → 0B/2A/3A/4A; R5 → 1A/2A/2B/3A/3B; R6 → 0A/1B/3B/3C; R7 → 0B/1A/4A; R8 → 2B/4A and delivery lifecycle. Each Review Focus item has an explicit owning behavioral test.

## Handoff

Roe authorized implementation. Use **native execution** with `superpowers:executing-plans`; tasks share sequential interfaces and each PR has exactly two mandated review stages. If Roe chooses subagents, preserve that choice while omitting extra independent review gates; wait for all agents before yielding.

Before implementation: reviewed plan, selected method, valid develop/delivery remote, and phase 0 opening checks. Planning changes only this document and its README entry; no implementation, branch changes, hook installation, credentials, or Jev inference.
