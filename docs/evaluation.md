---
read_when: Before collecting usage, materializing pilot cases, or making savings claims.
---

# Evaluation

Phases 0–4 supply measurement indicators, synthetic cases, shadow calibration, restricted native trials, seven-family qualification, check/reuse integration and a completed native paired experiment. Component measurements and native smoke establish their stated scopes. The full experiment did not qualify a family; no general saving is claimed.

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

## Jev Billing and Shadow Calibration

Aggregate a private JSONL collection of immutable decisions without exporting requests:

```sh
rtk proxy node src/pilot-evaluation.mjs jev-usage --decisions /private/decisions.jsonl
```

`collectJevUsage` counts each decision identity once. Attempted calls require independently valid usage and actual-model metadata; missing or inconsistent billing returns unknown totals, never zero. Records are written before task CAS, so losing writers still account for their requests. Rejected classifier answers and actual-model mismatches preserve valid billing metadata; malformed counters remain unknown. Local zero-attempt decisions do not manufacture provider consumption.

Phase 1 independently froze labels for all 66 final-turn tasks, question/corpus hashes, threshold 0.90 and choice margin 0.20 before live observations. Six tuning tasks and 60 held-out tasks used isolated owned synthetic fixtures, not private project code. The selected alias was `jev-latest`; the observed actual model was `jev-1.13.0`. These names describe this experiment, not a permanent discovery default.

The tuning and held-out observations accepted no semantic proposals. One local documentation recipe was initially wrong and fixed through a regression. Replay of the recorded responses against corrected source yields 19 correct local proposals/60 cases, zero wrong proposals and zero accepted semantic proposals, with no new provider requests. This corrective replay is not a fresh independent held-out evaluation. Per-family semantic error/utility estimates and calibrated activation thresholds are unsupported; retain all six questions as experimental candidates and keep Jev disabled.

Contract validation, tuning and held-out observation made 47 actual POST attempts. Independently retained usage gives a known lower bound of 33,126 tokens; one original malformed response lost its counters under the earlier client, so the exact total is unknown. The current client preserves independently valid counters, but a replay cannot repair historical missing billing. No provider cost or saving is inferred from incomplete usage.

Native shadow smoke confirms one installed trusted rule proposal with no tools, injection or Jev query; it does not establish task quality, complete provider/worker usage or savings. See [phase 1 validation](validation/phase-1.md). Future hybrid activation requires additional independent family evidence and demonstrated incremental benefit after its query cost and latency.

## Checks and Future Comparison

```sh
rtk proxy node scripts/verify-context-policy.mjs
```

The corrected follow-up source passes 215 tests and checks syntax, JSON/corpus consistency, source scope, approximately 500-line limits, and internal document links. Test files run serially because concurrent workers interfered with strict deadlines; production budgets and within-file concurrency tests are unchanged. Unavailable external reference links produce warnings; they are not claimed validated. Test-owned temporary roots move to Trash after each suite.

Native observations are recorded separately in [phase 0 validation](validation/phase-0.md) and [phase 1 validation](validation/phase-1.md). Direct App tools, direct command tools, MCP, compaction, and resume retain their stated unverified status. Remaining probes must be withdrawn before optimization-baseline runs. Later paired experiments must preserve model, effort, prompts, starting state, order/cache controls, full evidence/check outcomes, all providers/workers, and expansion/correction costs. Unknown usage and failed tasks cannot be silently discarded to manufacture savings.

## Paired Context Report

`report --runs <private-jsonl> --tasks evaluation/tasks.jsonl` recomputes all original rows; it never accepts a supplied promotion summary as proof. Each row needs unique `run_id`, frozen `task_id`, `split:held_out`, `family`, `variant`, exact `corpus_hash`, `prompt_hash`, `initial_revision`, `fixture_hash`, finite complete-task `duration_ms`, `order_index:0|1|2`, and `cache_control:recorded`.

`versions` binds supported `client_version`, `main_model`, `reasoning_effort`, `policy_hash`; hybrid also binds `questions_hash` and actual `jev_model`. Strict booleans `native_execution_verified` and `task_coverage_verified` must both be true. `codex_usage` requires `available:true` and all six counters above. `jev_usage` requires `available:true`, `input_tokens`, `output_tokens`, `total_tokens`, `requests`, and `models`; zero requests require zero tokens and an empty model list. Baseline/deterministic cannot contain Jev requests. Every queried hybrid model must equal its actual pinned fingerprint.

`quality` requires `correct:true`, `evidence_complete:true`, `checks_complete:true`, `critical_regression:false`. These are independently assessed facts, not values inferred from classifier agreement or filled in after an unobserved session. Usage must include workers, all providers, corrections and expansion costs; unknown coverage remains unknown and blocks promotion.

All sixty held-out tasks need all three actual variants per experiment, preserving paired prompt/state/model/effort and distinct order positions. Each family needs at least ten pairs, no failed required quality evidence, median total-token reduction of at least 20%, nonincreasing median duration, and p95 paired duration increase at most 1000 ms. Hybrid must additionally save tokens over the same deterministic family without extra individual latency. Separate `experiment_id` values identify repeat cohorts; duplicate identities are rejected. Any incomplete cohort conservatively blocks qualification even when its observed pairs remain useful descriptions.

The private report contains `report_version:1`, `corpus_hash`, original `runs`, family results, `promotions`, `limitations` and, for repeated input, `experiments`. Failed/excluded/incomplete task IDs remain named; invalid run IDs and original raw-row indexes explain rejected input without deleting it. Valid observed pairs still receive descriptive durations. `correct_pairs` counts quality-valid pairs with verified complete billing, not correct final answers; zero can coexist with many correct answers and unknown token metrics. Minimum/maximum/list reductions expose dispersion when billing qualifies.

Seven recognized families always receive deterministic/hybrid summaries; unmeasured families have sample zero and null metrics. Manager `promote` rechecks the entire current policy, owned installation, native coverage, actual family model/effort and source fingerprints before storing separate reports. Source fingerprints include the native trial and shared lock dependencies. A qualifying report cannot exceed the global mode cap; unknown versions and mixed actual provider models abstain. Reports trust independently collected owner attestations; private storage does not authenticate claims against a malicious report owner. See [operational commands](usage.md).

## Native Integration Limits

The temporary native trial is restricted to the exact public synthetic corpus and a private admission expiring within 24 hours. Native model/session/active-turn metadata supplies omitted version/effort only when independently validated; configured defaults cannot substitute. Its immutable observation measures preparation before its own audit; the actual native task wall clock includes audit/persistence and all ordinary operations. Metadata records attempted output, not verified delivery. The transcript must prove exact matching developer evidence before generation.

The historical `documentation_01` paired case used unchanged gpt-6.1-sol/xhigh and identical fixture/source in deterministic, baseline, hybrid order, with warm caches. All variants preserved the annotated result and required evidence; declared tests passed. Zero Jev queries mean this hybrid case measures no semantic value. Deterministic was slower than baseline, hybrid had no incremental token advantage over deterministic, and the incomplete sixty-task report refused promotion. Later source corrections invalidate that historical fingerprint as current promotion proof.

Current-source smoke is separately bound to corrected modules and the actual observed native model/effort, without overrides. Failed/abstained discovery and mismatched-effort attempts remain recorded, with their usage included rather than silently discarded. They are not favorable paired comparisons. See [phase 2 validation](validation/phase-2.md) for exact scope and results. Subscription pricing and incomplete historical billing remain unknown; no cost estimate or saving is invented.

## Phase 3 Component and Native Evidence

Ten identical component reads per source compared phase 2 with final phase-3 source `af35956`. The correctly selected current private directory contained ten artifacts/8750 bytes versus one artifact/957 bytes, with exact identical content and 673 response bytes on every read. Lower-middle durations from ten sorted observations were 131.12 ms and 127.29 ms. Order was fixed, caches were not reset and the component probe overlapped native smoke. These observations establish internal storage reuse, not causal latency or native token savings. An earlier v2 counter inspected the wrong state directory; its artifact-count conclusion was withdrawn and its raw record retained.

Fresh final-source native smoke used the existing Desktop engine `0.159.2`, actual `gpt-6.1-sol`/`high`, ordinary tools and unchanged permissions, with no model/effort overrides. It verified repeated exact delivery with shared storage, edit invalidation with BOM/CRLF retained, declared npm failure exit 7 and exact recovery of 26054 stderr bytes/1002 lines. The whole task took approximately 145.43 seconds. Twelve native per-response records match final CLI/session usage; all 33 commands, including one failed source lookup and three expected exit-7 operations, remain included. Raw usage, prompt, session identity and source hashes remain private. No worker inference was observed; broader auxiliary-provider coverage and subscription price remain unknown.

The earlier pre-review smoke is retained as historical evidence, not final-source certification. Actual reviewer-provider usage is also retained separately and is not subtracted from or attributed to optimizer savings. No production delivery receipt was created, no rewrite was admitted and no Jev query was made by these wrappers. Native compaction/resume, native rewrite/permission equivalence, Windows cancellation and actual Yarn execution remain unverified. See [phase 3 validation](validation/phase-3.md). Phase-4 outcomes follow below.

## Phase 4 Native Results

The unchanged corpus was executed through the existing Desktop-bundled CLI `0.159.2`, actual `gpt-6.1-sol`/`high`, with no model/effort or permission overrides. Source was frozen at `746478dfc63d8de501b2c6863c772f6c65179e72`; corpus SHA-256 was `293c22bfc46d9408308b6743ef99185924a75bb51351b9dd1578124707326893`. Follow-ups used real resumed prior turns. Variant order rotated per task; ambient caches and host load were recorded rather than reset, limiting causal interpretation.

| Cohort | Attempts | Native completions | Correct answers | Required-evidence omissions | Incomplete/broadened checks | Critical regressions |
|---|---:|---:|---:|---:|---:|---:|
| Separate tuning | 18 | 18 | 18 | 9 | 0 | 0 |
| Primary held-out | 180 | 177 | 171 | 43 | 2 | 0 |
| Variable repeats | 9 | 8 | 8 | 4 | 0 | 0 |
| Held-out plus repeats | 189 | 185 | 179 | 47 | 2 | 0 |

| Primary variant | Attempts | Native completions | Correct answers | Evidence omissions | Incomplete/broadened checks |
|---|---:|---:|---:|---:|---:|
| Baseline | 60 | 59 | 58 | 13 | 1 |
| Deterministic | 60 | 59 | 56 | 15 | 1 |
| Hybrid | 60 | 59 | 57 | 15 | 0 |

Four capacity failures remain failed attempts, including one partially executed documentation task. Two additional fixture-preparation failures made no native generation call and were preserved separately before fresh setup IDs were admitted. Three earlier identity-mismatched calibration attempts remain outside these cohorts. Configuration drift to medium/xhigh stopped the driver before another unmatched call; Roe restored high. No paid failed task was retried, prompt/corpus tuned or favorable result substituted.

All 207 scheduled task-attempt captures and counters remain private; 203 completed runs passed independent per-response versus final cumulative checks. Follow-up totals include prior native turns, corrections and expansions exactly once. Failed partial usage remains a lower bound or unknown, never zero. Complete worker/provider coverage is false and cost is null; main-session counters cannot become task-wide billing. Observed provider attempts total 58 (6 tuning, 51 primary, 1 repeat); 52 runs have unknown Jev billing, including missing-audit runs where a baseline label cannot establish zero.

Two completed primary runs lacked native trial observations. Their experimental source/variant identity remains unverified, without reruns. An independent zero-attempt provider audit on one of them remains known zero; missing observation alone does not determine billing. Strict frozen evidence/assertions also exceed some scoped prompts, including empty-range review, combined follow-up documentation and check-source requirements. Those tensions and the original unfavorable assessments remain recorded.

Corrected report generation retains the original 189 rows. Code-context descriptions contain 31 paired tasks, review 10, documentation 11 and checks 11; get-changes, continuation and rewrite families are unmeasured. The nine repeats add three observed pairs rather than a complete independent sixty-task cohort. Descriptive paired latency deltas, including failed attempts, are:

| Family | Pairs | Deterministic median / p95 delta (s) | Hybrid median / p95 delta (s) |
|---|---:|---:|---:|
| `code_context` | 31 | +3.655 / +81.310 | +2.373 / +45.841 |
| `code_review_context` | 10 | +7.577 / +44.221 | −10.276 / +90.612 |
| `documentation_context` | 11 | −9.059 / +28.268 | −2.993 / +22.222 |
| `run_project_checks` | 11 | +5.051 / +19.199 | +3.808 / +60.907 |

These are observed candidate-minus-baseline wall-clock differences, not controlled causal speedups. Every qualified total-token reduction is null and `promotions` is empty. Unknown complete billing, quality failures and incomplete repeats independently prevent activation. More paid cases cannot reconstruct historical missing counters or remove recorded omissions. Current source corrections also invalidate the frozen source as new qualification proof.

The global trial was withdrawn. Separate corrected-source off/uninstall smoke preserves foreign hooks, removes only owned hooks/skill, keeps a modified off/Jev-disabled policy and verifies a fresh native baseline with no tools or experimental context; foreign Ponytail context remains present. Positive native activation is unavailable because no real family qualifies. See [phase 4 validation](validation/phase-4.md) for source/review bindings and retention. Keep production observational and Jev disabled; no total-token or provider-cost saving is demonstrated.

## Offline Task Measurement

Read an explicitly prepared private manifest and byte-identical source copies:

```sh
umask 077
rtk proxy node scripts/measure-task-usage.mjs --manifest /private/measurement/task.json > /private/measurement/new-result.json
```

Use a new output filename; shell redirection can truncate an existing file. The script performs no discovery, network requests or writes. The manifest directory and source components must be owned by the current user, private (directories 0700, files 0600), canonical and free of symlinks. Source paths are relative to that directory and cannot escape it. Preserve raw evidence separately; never infer missing IDs, counters or settings from configuration defaults.

Manifest version 1 requires `manifest_version`, `task_id`, `run_id`, `client_version`, `main_model`, `reasoning_effort`, `root_session_id`, explicit root-turn membership, `captures`, `intervals`, `decisions`, and `closure`. New multi-turn manifests use ordered, unique, nonempty `root_turn_ids`; legacy `root_turn_id` remains supported. If both occur, they must denote the same singleton. Use actual observed model/effort. Capture descriptors are `{path, sha256, thread_id}`; decision descriptors are `{path, sha256}`. SHA-256 binds exact source bytes. Each interval supplies `{thread_id, start_response_id, end_response_id, initial_usage, final_usage, response_ids}`; plural membership additionally requires source-backed `turn_id`. A proven fresh thread uses `start_response_id:null`, zero initial counters and its native start record. A resumed interval names the last prior response and its cumulative counters, excluding earlier work. Closure contains `worker_source_refs` and `provider_source_refs` arrays; references or caller flags cannot authorize complete totals.

`readTaskUsageTranscript(path, options)` in `src/task-usage-transcript.mjs` supports only calibrated native `0.159.2`. Options bind client version, thread, root session and singular/plural root turns; `byte_limit` can narrow the default 64 MB snapshot limit and `read_budget` shares invocation limits. The reader streams one stable descriptor and retains hashes, byte counts and normalized subject/boundary responses and task metadata, discarding raw prompt/code bodies. It excludes inherited prefixes, deduplicates identical response IDs and rejects conflicting selected contexts/counters, resets, unsafe arithmetic, malformed UTF-8 and incomplete JSONL. Workers may have only a subset of declared root turns; `missing_root_turn_ids` identifies the rest. Native terminal records prove neither exhaustive descendant discovery nor complete provider billing.

`collectCompleteTaskUsage(manifest, captures, decisions)` in `src/task-usage.mjs` verifies source identities, acyclic admitted ancestry reaching the root, nonoverlapping interval order, cumulative deltas and independent increments. Conflicted or disconnected workers and all descendants contribute no response or provider turns. Reused workers/responses count once; admitted root turns without verified intervals produce a generic count limitation. Normalized decision inputs are `{path, source_sha256, records}` and match each descriptor's hash. Native `session_hash`/`turn_hash` use plain SHA-256 of admitted identities; supplied raw identities must agree. One canonical decision path is read once; repeated descriptors still validate their own hashes, and accounting admits reused record arrays once. Retained billing contains bounded identities, attempt counts, usage counters and actual-model names, not nested raw extras. Independently valid decision groups retain lower bounds beside abandoned attempts; conflicting groups contribute nothing. An empty or missing audit cannot prove task-wide zero.

Output uses `measurement_scope:task`, `task_coverage_verified:false`, unavailable complete `codex_usage`, `jev_usage` and `providers`, independently admitted `observed_providers`, `known_lower_bound`, source hashes and limitations. Monetary `cost` stays null. Cached input and reasoning remain included subsets. Useful partial output exits 1 because complete coverage is unavailable; that exit must not be relabelled a complete measurement failure or success.

`loadPrivateTaskMeasurement` in `scripts/measure-task-usage.mjs` limits manifests and decision files to 4 MB, captures to 64 MB each and 512 MB in aggregate, and both descriptor lists to 128 entries. Its optional aggregate byte argument may only narrow the 512 MB limit. Actual descriptor snapshots are charged, rather than trusting preflight sizes. Stable empty, absent or malformed sources remain unavailable while other admitted bounds survive. Unsafe paths, permissions, file types, changing snapshots or exceeded budgets reject the load with generic errors. Descriptor and ancestor checks detect persistent substitutions; they are not a sandbox against a malicious same-user process that swaps and restores paths. CLI JSON output is capped at 4 MB.

Additional streaming limits use decimal bytes and distinguish source-local failures from invocation rejection:

| Boundary | Limit | Failure scope |
|---|---:|---|
| JSONL row, including its terminator | 1,000,000 bytes | Affected source unavailable. |
| Nonblank parsed records per source | 100,000 | Affected source unavailable. |
| Parsed records shared across capture/decision readers | 250,000 | Whole measurement load rejected. |
| Unique namespaced response/decision identities | 100,000 | Whole measurement load rejected. |

Blank lines consume the byte/row limits but not parsed-record counts. A detected descriptor read failure, mutation or ancestor substitution rejects the whole load, even if parsing fails first. A stable malformed/over-limit source can preserve independent bounds. No peak-heap or runtime speed claim follows from these caps.

Shared snapshot exports live in `src/task-usage-transcript.mjs`: `resolvePrivateTaskReference(directory, reference)` admits a manifest-relative private source; `readPrivateTaskSnapshot(path, byteLimit=4_000_000, allowEmpty=false)` returns bounded bytes, hash and descriptor metadata; `readTaskFileSnapshot(path, byteLimit, requirePrivate=true, allowEmpty=false)` additionally supports the canonical public corpus. Empty input is allowed only at explicitly opted-in partial-evidence boundaries, not for a manifest or run collection. These are programmatic file-boundary helpers; use the two documented CLIs for ordinary measurement and diagnostics.

`taskRootTurnIds(value)` validates singular/plural membership. `createTaskReadBudget()` creates shared counters; `retainTaskReadIdentity(budget, namespace, identity)` charges each namespaced identity once. `readTaskJsonlSnapshot(path, options, onRecord)` accepts `budget`, `byte_limit` (default 4,000,000, maximum 64,000,000), and `allow_empty`; its callback receives parsed row, original-row SHA-256 and record index. Hashing, decoding and parsing use the same descriptor, with post-read integrity checks even after parse errors. It returns snapshot bytes/hash and record count; callbacks must retain only needed normalized metadata.

## Independent Omission Diagnostics

Copy original assessed rows and separate annotations into one private canonical directory, preserving exact bytes:

```sh
rtk proxy node scripts/diagnose-pilot-evidence.mjs --tasks evaluation/tasks.jsonl --runs /private/diagnostics/runs.jsonl --assessments /private/diagnostics/assessments.jsonl --output /private/diagnostics/new-report.json
```

The supplied public corpus must exactly equal this checkout's canonical corpus. Private run and assessment files are capped at 4 MB each and share the streaming record budget; empty assessments are valid. The loader hashes original row bytes including LF or CRLF and whitespace; an unterminated final row gets no invented newline. No reserialization supplies provenance. The version-1 hash contract is corrected from PR #6's LF-excluding implementation: preserve older artifacts and derive separate rebound annotations only after verifying exact original rows. Valid unknown diagnostics exit 0. Rejected input or requested-output failure exits 1 with generic diagnostics. Stdout contains only aggregates, source hashes and limitations, including tuning summary.

Optional `--output` saves the full `loadPilotEvidenceDiagnostic` result, including held-out/tuning run-level `details`, to a new owned 0600 file in an existing canonical private directory. Exclusive descriptor creation rejects existing destinations and symlinks; directory identity is rechecked around the write and sync. Save success precedes stdout success. The output is capped at 4 MB; a failed save may leave a private partial file. Retry with a new destination. No atomic-publication or automatic-cleanup guarantee is added.

`diagnosePilotEvidence(tasks, runSources, assessments)` in `src/pilot-evidence-diagnostics.mjs` never changes quality grades. New sources are authoritative `{row, run_row_sha256}` wrappers; their hashes override embedded row claims. Legacy pure callers retain supplied row hashes. Run IDs must be nonempty strings of at most 256 characters. Each annotation requires `run_id`, `task_id`, `run_row_sha256`, nonempty corpus-backed `requirement_ids`, `proof_sha256s`, typed `proofs` entries `{sha256, kind}`, and `primary_cause`. A hash authenticates bytes, not causal truth; annotations are owner-attested. The matching proof purposes are:

| Primary cause | Required proof kind | Diagnostic meaning |
|---|---|---|
| `selection_or_delivery` | `delivery_trace` | Relevant required evidence was missing from delivery. |
| `answer_omission` | `delivered_evidence` | Relevant evidence reached context but was omitted from the answer. |
| `corpus_scope_mismatch` | `scope_annotation` | Frozen requirements exceed the scoped request. |
| `unknown` | `unverified` | No supported causal distinction. |

Missing, stale, invalid or contradictory annotations remain unknown and counted. Semantically identical annotations are accepted regardless of object-key or evidence-set ordering. `unassessed_attempt_count` counts only omitted attempts with no annotation; it is a subset of unknown causes. `invalid_assessment_count` is separate annotation metadata, not another cause bucket. Unknown quality is separate; unknown variants contribute to cohort totals without becoming a recognized treatment. Tuning never enters held-out totals. Absence from a retained full-body matcher alone cannot establish missing relevant delivery.

## Historical Remeasurement and Three Treatments

PR #6 offline remeasurement examined all 189 retained held-out/repeated captures, without another paid cohort, tuning or favorable retries. Source-bound final-root-turn Codex interval lower bounds were verified for 187 attempts; two remain unknown. These intervals exclude earlier setup/follow-up turns and cannot replace wider historical conversation totals. PR #7 replays three archived native manifests and all 189 diagnostic rows; it does not claim all 189 raw captures were remeasured with the follow-up source. No capture establishes exhaustive worker/provider closure; complete-task totals and saving estimates remain null.

| Treatment, including repeats | Attempts | Correct answers | Original omission attempts | Scope mismatch annotations | Unknown causes |
|---|---:|---:|---:|---:|---:|
| Reference baseline | 63 | 61 | 14 | 7 | 7 |
| Deterministic rules without Jev | 63 | 59 | 16 | 6 | 10 |
| Hybrid rules with Jev where queried | 63 | 59 | 17 | 8 | 9 |
| Total | 189 | 179 | 47 | 21 | 26 |

The hybrid treatment label does not mean every attempt queried Jev. Source/turn admission yields 122 observed Jev billing aggregates and 67 unavailable aggregates for these narrower intervals; this differs from the wider original report's billing scope. Neither available zero-attempt records nor verified Codex intervals establish complete auxiliary-provider coverage. Unknown billing cannot be substituted with zero or omitted to manufacture a comparison.

All original corpus, assessed rows, source binding and reports remain byte-identical. The 21 scope annotations do not repair or overturn original unfavorable grades; 26 causes remain unknown. The two check failures retain separate diagnostics for capacity interruption and broadened test scope. Current measurement-source corrections are not a new optimizer qualification experiment. See [task measurement validation](validation/task-measurement.md) and [usage](usage.md). Jev remains disabled and no family is promoted.
