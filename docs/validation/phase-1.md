---
summary: Phase 1 identity, failing-test-first evidence, and delivery limits.
read_when: Before assessing phase 1 or resuming its implementation.
---

# Phase 1 Validation

## Starting identity

- Date: 2026-10-01.
- Verified local and remote develop: `47ac03db561efce16c44a907bb01be72c5def40c`.
- Feature branch: `feat/codex-token-efficiency-phase-1`.
- Worktree: `/Users/mrz/Documents/Roe/tools/LifeOS/codex-token-efficiency-worktrees/phase-1`.
- PR base: `develop`; a phase 1 PR has not been opened.
- Execution: native inline; mandatory reviewers are separate lifecycle stages.
- Baseline gate: 36 tests passed, no failures or skips; syntax, corpus, JSON, links, and source checks passed.

## Runtime prerequisites

Phase 0 PR #1 is merged into develop. Its worktree and feature branch remain because the primary native hook registration still references that source. Phase 1 must not delete or silently repoint it.

Jev calibration requires a locally available `TYPESAFE_API_KEY` and an authenticated model discovery. Roe chose local credential configuration; completion has not been confirmed. Roe subsequently requested credential setup as part of hook installation. `install --configure-jev --apply` now uses a hidden native macOS Keychain prompt, authenticated model discovery, and private model configuration. Environment credentials take precedence over the Keychain fallback. No credential is put in hook JSON, argv, Git, or telemetry. Hybrid calibration and token savings remain unverified.

## Implementation status

Task 1A and the task 1B contract/installer code are implemented. The new phase 1 registration is trusted; two native codex_exec shadow sessions completed. Live Jev calibration, both review stages, release documentation, merge, and safe cleanup remain pending. The older phase 0 handler remains off.

## Task 1A TDD evidence

- Initial empty interfaces: `state_isolation_and_continuity` failed on the missing native session identity; privacy test failed on the missing external-link inventory observation.
- After implementation: isolation, edit/new-file invalidation, optimistic concurrency, unknown child identity, metadata-only immutable decisions, and private file modes passed.
- Added a seven-turn continuation regression: failed because request rotation discarded the active review objective; retaining the explicit active request made it pass.
- CLI shadow regression: failed because no observation was persisted; the hook now records separate sessions, rereads off/enforce settings, ignores unsupported events, and emits no context.
- Expiration and ancestor-link regression: observed failures for reused expired state and writes through a linked ancestor; seven-day logical expiration and canonical ancestor checks made it pass.
- Full gate after these changes: 41 tests passed, no failures or skips. No savings, native shadow compatibility, or Jev calibration is inferred from these local tests.

Private state keeps at most six explicit recent requests and the explicit active request, each limited to 6,000 UTF-8 bytes. Inventory capture hashes up to 64 MB in 1.8 seconds and abstains beyond either limit. Seven-day expiration is applied on access; immutable owned decision files are pruned in the accessed session. No daemon is introduced.

## Task 1B TDD evidence

- Empty interfaces failed on a valid grouped response, bounded minimization, semantic recipe selection, and authenticated discovery.
- Validated full named-answer schemas, finite probabilities, exact labels/distributions (sum tolerance 1e-6), actual model, and nonnegative safe-integer usage. Malformed JSON, 401/429/5xx, contradictions, and uncertainty abstain; no repair request or retry.
- Query budget includes the entire serialized request (6,000 UTF-8 bytes), all body reads, a one-second deadline, and the shared handler deadline. A stalled cleanup regression failed before removing an unbounded cancellation wait.
- Requests are limited to single-line explicit text of at most 1,600 bytes per current/active request plus safe scalar facts. Secret/code/opaque-token detection and oversized state abstain without sending. This conservative minimization may reduce eligible requests.
- Unknown continuity keeps the previous explicit objective available privately, without granting a deterministic action. An unresolved intervening request followed by “hazlo” failed before the continuity guard was corrected. Validated observations can confirm continuity or retain a newly explicit objective; protected requirements remain intact.
- Setup and the real hook tests failed before linking authenticated discovery and one eligible request to persisted shadow decisions. Local conclusive facts, off, and disabled Jev make zero requests.
- Jev usage tests failed before unique immutable decisions were aggregated. Duplicate decisions cannot double-count; missing or inconsistent billable usage stays unknown. Evaluator CLI: `jev-usage --decisions <private-jsonl>`.
- Installer credential tests failed on environment precedence, native hidden setup, and noninteractive installation handling. Unsafe native Keychain writes and paid services are mocked only at those external boundaries; executable installation/model configuration is exercised against temporary roots. No real user Keychain entry was changed by tests.
- Full gate: 54 tests passed, no failures or skips; syntax, corpus, JSON, links, and source checks passed. Real authenticated inference and threshold calibration are still pending.

## Native phase 1 shadow observations

Roe trusted the new UserPromptSubmit handler. A fresh native hooks/list result shows that exact phase 1 source as trusted, alongside the preserved earlier registrations.

Two separate codex_exec sessions used the installed Desktop engine 0.159.2, inherited CLI model/effort, the same compatibility prompt, and no model tools. Both exited 0 and returned the exact requested reply. Each session matched its own private decision directory; both recorded a local code_context proposal with applied:false, provider_attempts:0, and 0600 record permissions. Neither reported a hook trust or observation failure. These are compatibility observations, not paired optimization trials or savings evidence.

The native hook input did not establish a client version for the handler's version record; it remains unverified even though the test launcher version is known. Direct Desktop shadow execution and complete-task/worker measurement remain unverified. Configuration changes between invocations are exercised by real CLI hook-process tests; no additional live model session is inferred from them.

## Credential setup scope

Use the current phase 1 source in a local interactive terminal:

```sh
cd /Users/mrz/Documents/Roe/tools/LifeOS/codex-token-efficiency-worktrees/phase-1
rtk proxy node scripts/manage-context-policy.mjs install --repo "$PWD" --source "$PWD" --apply --configure-jev
```

Native security prompts for the key with -w last, avoiding the process argument list. The fixed Keychain service is codex-token-efficiency.typesafe-api-key, account codex-token-efficiency. The creator's default native access control is retained; access is not granted to all applications. Hooks retrieve it only for eligible Jev requests with a bounded, cancellable native lookup. Installing a key/model preserves the current policy mode and Jev enable switch; it does not grant an operation promotion. Hook removal does not delete the shared user credential.

Roe's manual credential setup and the first authenticated model discovery are pending. A presence-only check found no environment or matching Keychain credential; its contents were never exported.
