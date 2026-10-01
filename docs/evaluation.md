---
read_when: Before collecting usage, materializing pilot cases, or making savings claims.
---

# Evaluation

Phase 0 supplies measurement indicators and synthetic cases. It contains no baseline/deterministic/hybrid comparison, trial hook, report, promotion, cost estimator, or measured token savings. Those belong to later phases.

## Session Usage

Read an existing private transcript without exporting its contents:

```sh
rtk proxy node src/pilot-evaluation.mjs usage --transcript /private/session.jsonl --client-version 0.159.2
```

The adapter accepts only observed `0.159.2` and `0.159.3` metadata and six cumulative counters: `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`, and `total_tokens`. Counts must be nonnegative safe integers; cached input cannot exceed input, reasoning cannot exceed output, and total must equal input plus output. Cached and reasoning counts are included subsets, not extra totals.

`collectCodexUsage(events, clientVersion)` accepts supplied normalized events with explicit `session_id`, `thread_id`, `counter_epoch`, and `usage`. Duplicate snapshots count once; verified separate epochs add. Unexplained decreases, malformed identities/counters, overflow, or unsupported versions return `available:false` and null counters. The caller must establish complete thread/epoch coverage independently.

The transcript CLI rejects interior corruption and impossible final JSON prefixes. It may ignore a genuinely incomplete last JSON object without a trailing newline; that diagnostic never echoes transcript data. Its stream is bounded to the initial file size, so later appends do not change the snapshot. Incomplete-tail detection depends on the tested Node parser's error format; an unrecognized format fails closed.

Output always includes `measurement_scope:"session"` and `worker_coverage_verified:false`. An inherited worker transcript can change metadata identity and is rejected conservatively. Manual validation established separate parent/worker counter relationships in one real CLI trial, but automatic worker discovery remains unavailable. These indicators cannot authorize promotion or task-wide savings claims.

## Corpus and Fixture

Validate the versioned cases:

```sh
rtk proxy node src/pilot-evaluation.mjs corpus --tasks evaluation/tasks.jsonl
```

The corpus contains 60 held-out cases, ten each for code analysis, review, documentation, checks, short follow-ups, and exhaustive requests, plus six separate tuning cases. Conversations cannot cross those splits. Each case declares its revision, fixture hash/profile, deidentified requests, required evidence, expected checks, and independently annotated outcome assertions. Required check names refer to the fixture's package scripts; exact test scope appears in the assertions. Assertions still require task assessment; corpus validity is not proof of task success.

Materialize into a new empty private directory:

```sh
rtk proxy node src/pilot-evaluation.mjs fixture --repo /absolute/empty-trial --variant baseline
rtk proxy node src/pilot-evaluation.mjs fixture --repo /absolute/another-empty-trial --variant changes
```

The fixture has 533 tracked files: 21 named files and 512 archive files. Its executable dependency chain, Unicode/newline filenames, staged/unstaged changes, rename/deletion, untracked addition, and declared long-stderr exit-7 check exercise the planned evidence boundaries. `baseline` and `changes` select fixture states, not measured optimizer variants. Git identity/date/configuration, hooks, global/system settings, excludes, attributes, and inherited Git routing variables are isolated to retain reproducibility. No package installation is performed.

Pinned baseline revision: `7a8ed42d9c6fc50aa421110d0ac71be4824d3e40`. Fixture descriptor SHA-256: `647e9ff0c96c3a3ef783e4302dcfc38a811085c3cf741a3228b300cf966f3a65`.

## Checks and Future Comparison

```sh
rtk proxy node scripts/verify-context-policy.mjs
```

The current gate passes 36 tests and checks syntax, JSON/corpus consistency, source scope, approximately 500-line limits, and internal document links. Unavailable external reference links produce warnings; they are not claimed validated. Test-owned temporary roots move to Trash after each suite.

Native observations are recorded separately in [phase 0 validation](validation/phase-0.md). Direct App tools, direct command tools, MCP, compaction, and resume retain their stated unverified status. Remaining probes must be withdrawn before optimization-baseline runs. Later paired experiments must preserve model, effort, prompts, starting state, order/cache controls, full evidence/check outcomes, all providers/workers, and expansion/correction costs. Unknown usage and failed tasks cannot be silently discarded to manufacture savings.
