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

Task 1 calibration complete; implementation and two required reviews remain pending. Jev stays disabled; historical comparisons and promotions remain unchanged.
