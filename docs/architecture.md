---
read_when: Before changing hook installation, policy dispatch, or usage measurement.
---

# Current Architecture

Phase 0 uses Node standard-library modules, native project hooks, and existing Git. There is no resident daemon, new provider framework, database, dependency installation, or custom Codex interface.

| Module | Current responsibility |
|---|---|
| `src/codex-context-policy.mjs` | Read current cwd policy; handle bounded hook stdin; preserve baseline in every phase-0 mode. |
| `scripts/manage-context-policy.mjs` | Preview/apply additive native registration and owned withdrawal. |
| `src/pilot-evaluation.mjs` | Validate supplied cumulative usage, read observed transcripts, validate corpus, materialize synthetic fixtures. |
| `scripts/verify-context-policy.mjs` | Run real syntax/tests/JSON/corpus/document-link/source-scope checks. |
| `tests/context-hook-probe.mjs` | Temporary native compatibility marker and hash-only event observation; never production policy. |

The native client invokes the installed absolute Node/source command with hook JSON on stdin. The policy rereads configuration on each call and emits no optimization. Project-local coverage permits registration only for observed events; it does not establish new client coverage by itself. Native trust remains controlled by the user and client.

## Ownership and Failure Recovery

Linked worktrees share the primary checkout's native hook document and exclusive installer lock. Each target retains its policy, coverage, and receipt locally. Registration commands contain a stable SHA-256 target marker, distinguishing otherwise identical installations without changing hook arguments. Normalized overlap checks still reject borrowing another live registration.

Install ordering is staged ownership → initial off policy → hook mutation → receipt compaction. Pending ownership remains recoverable if a later write fails. Successful withdrawal releases obsolete ownership; distinct markers preserve another target's replacement even during pending recovery. Remove ordering is hooks → unchanged created policy → receipt. One owned instance is removed; copied or modified foreign evidence is preserved. Ambiguous modified ownership fails before writes.

Writes use exclusive temporary files, preserve existing modes, compare prior bytes, and rename atomically under the shared lock. The result reports applied files even on failure. Static directory/file symlinks are rejected for installation; removal preserves nonregular policy without reading its target. A missing source can still be removed through the recorded canonical root or original alias. The user must preserve ownership receipts and check installed references before deleting any worktree.

## Measurement Boundary

Usage collection requires explicit session, thread, and counter-epoch identity. It keeps the final cumulative snapshot per identity, checks monotonicity, and never adds reasoning output twice. Unknown measurement remains null.

The transcript adapter supports only observed versions `0.159.2` and `0.159.3`; it reads a bounded initial-size snapshot and rejects corruption or changing metadata identity. Its CLI always reports session scope and unverified worker coverage. Manually validated worker relationships are separate evidence, not automatic complete-task discovery.

Future state, deterministic decisions, Jev, protected retrieval, deduplication, checks, rewriting, and promotions follow the [plan](plans/2026-09-30-codex-token-efficiency.md). None is activated by this phase. See [usage](usage.md) and [evaluation](evaluation.md).
