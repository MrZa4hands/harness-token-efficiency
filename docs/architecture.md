---
read_when: Before changing hook installation, policy dispatch, or usage measurement.
---

# Current Architecture

Phases 0–2 use Node standard-library modules, native hooks, and existing Git/rg. There is no resident daemon, new provider framework, database, dependency installation, or custom Codex interface.

| Module | Current responsibility |
|---|---|
| `src/codex-context-policy.mjs` | Verify installation/identity, reread policy, capture decisions, prepare eligible context, validate promotion before emission; setup and read-operation CLI. |
| `scripts/manage-context-policy.mjs` | Additive native hook/skill registration, hidden credential/model setup, recomputed context promotion, and owned withdrawal. |
| `src/context-state.mjs` | Raw repository snapshots, protected requirements, conservative continuity, private CAS storage, immutable decisions, bounded expiry. |
| `src/jev-client.mjs` | Minimize safe scalar state, validate grouped answers/model/usage, issue one bounded request, discover/configure models. |
| `src/context-credentials.mjs` | Prefer the environment, otherwise bounded Keychain lookup; native hidden setup outside the hook. |
| `src/repository-context.mjs` | Exact protected selection, literal references, inert immutable Git reads, raw stage/range diffs, original utility diagnostics. |
| `src/context-results.mjs` | Private hash-bound whole-unit pages and current task/revision revalidation. |
| `src/context-prefetch.mjs` | Code/review/documentation recipes under the shared deadline and byte envelope; incomplete proposals abstain. |
| `src/context-promotion.mjs` | Complete paired corpus/quality/usage/version criteria and independent deterministic/hybrid qualification. |
| `src/context-trial.mjs` | Private expiring native corpus admission; experimental preparation/audit, never production activation. |
| `scripts/manage-context-trial.mjs` | Additive owned global trial registration and exact withdrawal with separate native trust. |
| `src/pilot-evaluation.mjs` | Usage/transcript/corpus adapters, fixtures, restricted trial CLI and recomputed paired reports. |
| `scripts/verify-context-policy.mjs` | Run real syntax/tests/JSON/corpus/document-link/source-scope checks. |
| `tests/context-hook-probe.mjs` | Temporary native compatibility marker and hash-only event observation; never production policy. |

The native client invokes the installed absolute Node/source command with hook JSON on stdin. Off returns without repository/network work. Enabled UserPromptSubmit captures canonical state, resolves local facts, optionally queries Jev, records metadata, persists state through CAS, and prepares exact evidence. Shadow keeps results private. Enforce emits only an independently qualified current family/model/effort/source report under the global/family cap. Proposal audits explicitly do not certify native delivery. Project coverage permits registration of observed events; native trust remains controlled by the user and client.

## State and Decision Boundaries

Capture hashes raw HEAD, index, inventory, working bytes and full file modes, then rechecks each identity. It avoids Git status and clean conversion filters while retaining effective ignore intent. Unsupported submodules/symlinks, changing snapshots and inventory over 64 MB or 1.8 seconds abstain. The entire handler shares a two-second deadline, including selection and final audit writes. Automatic reads reject nonregular files without waiting for FIFO writers. A saved capture remains valid when optional later preparation expires.

State keeps six recent explicit requests and the active objective, each at most 6,000 UTF-8 bytes, below a one-megabyte serialized cap. Paths and literal symbols remain protected; exhaustive scope uses a bounded lexical rule. Known short continuations preserve the objective. CAS conflicts and interruptions leave an independent history-gap marker; configuration transitions also make continuity unknown. Ambiguous partial recovery stays baseline until a standalone explicit request restores continuity. Native compaction/resume and child identity coverage remain limited; no delivered-context cache exists yet.

Private directories/files use 0700/0600. Seven-day logical expiry prevents stale continuity. Physical cleanup is opportunistic within 25 ms during enabled decision recording: it revalidates owned expired sibling state under a lock and avoids locking live sessions. Off/idle periods and large traversals have no physical deletion or progress guarantee. Corrupt state and crashed locks require deliberate recovery, never automatic takeover. Failures before a valid capture retain baseline with a generic diagnostic rather than fabricate decision metadata.

Jev receives only bounded current/active explicit text and scalar facts, never repository code or the complete conversation. Known sensitive patterns and unminimizable/history-gap state abstain. Six fixed questions, exact labels/probabilities, contradictions, executed-model identity and safe-integer usage are validated. There is at most one POST, no retries/redirects, and a one-second network/body deadline within the shared handler budget. This known-pattern guard is not universal secret detection.

The selected alias is recorded separately from each decision's actual executed model. A retained expected actual model survives local turns and failures; unexpected drift abstains. Explicit alias changes clear the old automatic expectation; admitted actual-model pins replace it, and removing a pin cannot revive an older one. Independently valid actual-model/usage metadata survives rejected answer contracts and task persistence conflicts. Missing billable usage remains unknown.

## Ownership and Failure Recovery

Linked worktrees share the primary checkout's native hook document and exclusive installer lock. Each target retains its policy, coverage, and receipt locally. Registration commands contain a stable SHA-256 target marker, distinguishing otherwise identical installations without changing hook arguments. Normalized overlap checks still reject borrowing another live registration.

Install ordering is staged ownership → initial off policy → hook mutation → receipt compaction. Pending ownership remains recoverable if a later write fails. Successful withdrawal releases obsolete ownership; distinct markers preserve another target's replacement even during pending recovery. Remove ordering is hooks → unchanged created policy → receipt. One owned instance is removed; copied or modified foreign evidence is preserved. Ambiguous modified ownership fails before writes.

Writes use exclusive temporary files, preserve existing modes, compare prior bytes, and rename atomically under the shared lock. The result reports applied files even on failure. Static directory/file symlinks are rejected for installation; removal preserves nonregular policy without reading its target. A missing source can still be removed through the recorded canonical root or original alias. The user must preserve ownership receipts and check installed references before deleting any worktree.

The native operations skill is an owned source symlink, not a source copy. Receipt-verified untracked managed runtime bodies are private during automatic selection; tracked, foreign and explicitly requested evidence remains available. Automatic worktree review conservatively abstains on unignored private runtime or unknown/narrowed scope. Temporary native trials use a separate expiring admission and global ownership receipt; withdrawal preserves foreign definitions.

## Exact Evidence and Recovery

Changes compare raw HEAD/index/worktree bytes; owner-execute determines canonical Git mode. Scratch no-index diffs isolate attributes, parent configuration, external conversions, lazy fetching and replacement refs. Fresh raw scratch bytes are purged before their empty directory goes to Trash; cancellation and original errors survive cleanup. Range selectors read immutable blobs. UTF-8 content and filenames preserve BOM; non-UTF8 evidence and diagnostics have labelled base64 representations.

Protected explicit paths, found imports/callers/tests/instructions and exhaustive matches cannot be removed by ranking. Literal/dynamic/external reference limits retain partial coverage. Review selection seeds dependencies from every verified changed-file page. Routine complete envelopes use whole units; omissions expose exact whole-unit cursors instead of slicing required evidence.

Private results bind root/session/request/raw revision/epoch and are revalidated on expansion. A result hash also binds its complete stored bytes; owned permissions, regular-file admission and seven-day logical expiry are required. Physical result deletion and confirmed-delivery reuse follow phase 3. Uncertain compaction/resume still requires fresh evidence.

## Measurement Boundary

Usage collection requires explicit session, thread, and counter-epoch identity. It keeps the final cumulative snapshot per identity, checks monotonicity, and never adds reasoning output twice. Unknown measurement remains null.

The transcript adapter supports only observed versions `0.159.2` and `0.159.3`; it reads a bounded initial-size snapshot and rejects corruption or changing metadata identity. Its CLI always reports session scope and unverified worker coverage. Manually validated worker relationships are separate evidence, not automatic complete-task discovery.

Paired promotion validates all sixty held-out identities in three variants, actual complete usage/model/effort/source, quality, order/cache records and family thresholds. Only observed clients 0.159.2/0.159.3 can qualify. Hybrid additionally binds every executed Jev model and demonstrates incremental value. One native paired case and current-source smoke establish integration only; no family is promoted. Deduplication, checks, rewriting and the full repeated experiment follow phases 3–4 of the [plan](plans/2026-09-30-codex-token-efficiency.md). See [usage](usage.md), [evaluation](evaluation.md), and [phase 2 validation](validation/phase-2.md).
