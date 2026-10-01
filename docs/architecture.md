---
read_when: Before changing hook installation, policy dispatch, or usage measurement.
---

# Current Architecture

Phases 0–1 use Node standard-library modules, native project hooks, and existing Git. There is no resident daemon, new provider framework, database, dependency installation, or custom Codex interface.

| Module | Current responsibility |
|---|---|
| `src/codex-context-policy.mjs` | Verify installation ownership, reread private policy, capture state, resolve and record shadow decisions; authenticated model setup CLI. |
| `scripts/manage-context-policy.mjs` | Preview/apply additive native registration, hidden credential/model setup, and owned withdrawal. |
| `src/context-state.mjs` | Raw repository snapshots, protected requirements, conservative continuity, private CAS storage, immutable decisions, bounded expiry. |
| `src/jev-client.mjs` | Minimize safe scalar state, validate grouped answers/model/usage, issue one bounded request, discover/configure models. |
| `src/context-credentials.mjs` | Prefer the environment, otherwise bounded Keychain lookup; native hidden setup outside the hook. |
| `src/pilot-evaluation.mjs` | Validate supplied cumulative usage, read observed transcripts, aggregate immutable Jev usage, validate corpus, materialize fixtures. |
| `scripts/verify-context-policy.mjs` | Run real syntax/tests/JSON/corpus/document-link/source-scope checks. |
| `tests/context-hook-probe.mjs` | Temporary native compatibility marker and hash-only event observation; never production policy. |

The native client invokes the installed absolute Node/source command with hook JSON on stdin. Off returns without repository/network work. Enabled UserPromptSubmit captures canonical repository/session state, resolves local facts, optionally queries Jev when safe and unresolved, writes immutable decision metadata, then persists state through CAS. Shadow and unpromoted enforce emit no optimization. Project-local coverage permits registration only for observed events; it does not establish new client coverage by itself. Native trust remains controlled by the user and client.

## State and Decision Boundaries

Capture hashes raw HEAD, index, inventory and working bytes, then rechecks HEAD/inventory/index and every captured file's identity/metadata. It avoids Git status and clean conversion filters. Global/system Git configuration is isolated; raw inventory follows repository-local ignores. Submodules, external symlinks, changing snapshots and inventory over 64 MB or 1.8 seconds abstain. The entire handler shares a two-second deadline, including final literal-path selection. Automatic reads reject nonregular files without waiting for FIFO writers.

State keeps six recent explicit requests and the active objective, each at most 6,000 UTF-8 bytes, below a one-megabyte serialized cap. Paths and literal symbols remain protected; exhaustive scope uses a bounded lexical rule. Known short continuations preserve the objective. CAS conflicts and interruptions leave an independent history-gap marker; configuration transitions also make continuity unknown. Ambiguous partial recovery stays baseline until a standalone explicit request restores continuity. Native compaction/resume and child identity coverage remain limited; no delivered-context cache exists yet.

Private directories/files use 0700/0600. Seven-day logical expiry prevents stale continuity. Physical cleanup is opportunistic within 25 ms during enabled decision recording: it revalidates owned expired sibling state under a lock and avoids locking live sessions. Off/idle periods and large traversals have no physical deletion or progress guarantee. Corrupt state and crashed locks require deliberate recovery, never automatic takeover. Failures before a valid capture retain baseline with a generic diagnostic rather than fabricate decision metadata.

Jev receives only bounded current/active explicit text and scalar facts, never repository code or the complete conversation. Known sensitive patterns and unminimizable/history-gap state abstain. Six fixed questions, exact labels/probabilities, contradictions, executed-model identity and safe-integer usage are validated. There is at most one POST, no retries/redirects, and a one-second network/body deadline within the shared handler budget. This known-pattern guard is not universal secret detection.

The selected alias is recorded separately from each decision's actual executed model. A retained expected actual model survives local turns and failures; unexpected drift abstains. Explicit alias changes clear the old automatic expectation; admitted actual-model pins replace it, and removing a pin cannot revive an older one. Independently valid actual-model/usage metadata survives rejected answer contracts and task persistence conflicts. Missing billable usage remains unknown.

## Ownership and Failure Recovery

Linked worktrees share the primary checkout's native hook document and exclusive installer lock. Each target retains its policy, coverage, and receipt locally. Registration commands contain a stable SHA-256 target marker, distinguishing otherwise identical installations without changing hook arguments. Normalized overlap checks still reject borrowing another live registration.

Install ordering is staged ownership → initial off policy → hook mutation → receipt compaction. Pending ownership remains recoverable if a later write fails. Successful withdrawal releases obsolete ownership; distinct markers preserve another target's replacement even during pending recovery. Remove ordering is hooks → unchanged created policy → receipt. One owned instance is removed; copied or modified foreign evidence is preserved. Ambiguous modified ownership fails before writes.

Writes use exclusive temporary files, preserve existing modes, compare prior bytes, and rename atomically under the shared lock. The result reports applied files even on failure. Static directory/file symlinks are rejected for installation; removal preserves nonregular policy without reading its target. A missing source can still be removed through the recorded canonical root or original alias. The user must preserve ownership receipts and check installed references before deleting any worktree.

## Measurement Boundary

Usage collection requires explicit session, thread, and counter-epoch identity. It keeps the final cumulative snapshot per identity, checks monotonicity, and never adds reasoning output twice. Unknown measurement remains null.

The transcript adapter supports only observed versions `0.159.2` and `0.159.3`; it reads a bounded initial-size snapshot and rejects corruption or changing metadata identity. Its CLI always reports session scope and unverified worker coverage. Manually validated worker relationships are separate evidence, not automatic complete-task discovery.

Protected retrieval, delivered-context deduplication, checks, rewriting, paired trials and promotions follow phases 2–4 of the [plan](plans/2026-09-30-codex-token-efficiency.md). Phase 1 remains observational, and its actual calibration does not justify semantic activation. See [usage](usage.md), [evaluation](evaluation.md), and [phase 1 validation](validation/phase-1.md).
