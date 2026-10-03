---
read_when: Before changing hook installation, policy dispatch, or usage measurement.
---

# Current Architecture

Phases 0–4 use Node standard-library modules, native hooks, and existing Git/rg. There is no resident daemon, new provider framework, database, dependency installation, or custom Codex interface.

| Module | Current responsibility |
|---|---|
| `src/codex-context-policy.mjs` | Verify installation/identity, reread policy, capture decisions, prepare eligible context, validate promotion before emission; setup and read-operation CLI. |
| `scripts/manage-context-policy.mjs` | Additive native hook/skill registration, hidden credential/model setup, seven-family qualification, immediate mode changes and owned withdrawal. |
| `src/context-install-lock.mjs` | Resolve the registered primary checkout shared by installer, mode, promotion and Jev policy writers. |
| `src/context-state.mjs` | Raw repository snapshots, protected requirements, conservative continuity, private CAS storage, immutable decisions, bounded expiry. |
| `src/jev-client.mjs` | Minimize safe scalar state, validate grouped answers/model/usage, issue one bounded request, discover/configure models. |
| `src/context-credentials.mjs` | Prefer the environment, otherwise bounded Keychain lookup; native hidden setup outside the hook. |
| `src/repository-context.mjs` | Exact protected selection, literal references, inert immutable Git reads, raw stage/range diffs, original utility diagnostics. |
| `src/context-results.mjs` | Exact reusable private artifacts, whole-unit pages, current-code and original-check identity validation. |
| `src/context-result-expiry.mjs` | Owned artifact/header admission and bounded opportunistic physical expiry. |
| `src/project-checks.mjs` | Current declared-check admission, explicit execution, cancellation, exact logs and visible infrastructure failures. |
| `src/context-prefetch.mjs` | Code/review/documentation recipes under the shared deadline and byte envelope; incomplete proposals abstain. |
| `src/context-promotion.mjs` | Seven-family paired criteria, descriptive cohort aggregation, failed/excluded/invalid-row identities and independent deterministic/hybrid qualification. |
| `src/context-trial.mjs` | Private expiring native corpus admission, ordered prior-turn/audit/version binding and production-equivalent hybrid continuity; never production activation. |
| `scripts/manage-context-trial.mjs` | Additive owned global trial registration and exact withdrawal with separate native trust. |
| `src/pilot-evaluation.mjs` | Usage/transcript/corpus adapters, fixtures, restricted trial CLI and recomputed paired reports. |
| `src/task-usage-transcript.mjs` | Version-0.159.2 subject response normalization and bounded immutable private snapshots, including safe empty evidence. |
| `src/task-usage.mjs` | Source-bound interval arithmetic, admitted native decision identities and separate verified lower bounds; no exhaustive closure claim. |
| `scripts/measure-task-usage.mjs` | Offline private manifest/capture/audit loading with descriptor byte budgets and aggregate-only CLI output. |
| `src/pilot-evidence-diagnostics.mjs` | Exact-row-bound owner-attested omission causes, preserved original grades and separate tuning aggregation. |
| `scripts/diagnose-pilot-evidence.mjs` | Bounded corpus/run/annotation snapshots and aggregate-only historical diagnostics. |
| `scripts/verify-context-policy.mjs` | Run syntax/tests/JSON/corpus/document-link/source-scope checks with serial deadline-sensitive test files. |
| `tests/context-hook-probe.mjs` | Temporary native compatibility marker and hash-only event observation; never production policy. |

The native client invokes the installed absolute Node/source command with hook JSON on stdin. Off returns without repository/network work. Enabled UserPromptSubmit captures canonical state, resolves local facts, optionally queries Jev, records metadata, persists state through CAS, and prepares exact evidence. Shadow keeps results private. Enforce emits only an independently qualified current family/model/effort/source report under the global/family cap. Proposal audits explicitly do not certify native delivery. Project coverage permits registration of observed events; native trust remains controlled by the user and client.

## State and Decision Boundaries

Capture hashes raw HEAD, index, inventory, working bytes and full file modes, then rechecks each identity. It avoids Git status and clean conversion filters while retaining effective ignore intent. Unsupported submodules/symlinks, changing snapshots and inventory over 64 MB or 1.8 seconds abstain. The entire handler shares a two-second deadline, including selection and final audit writes. Automatic reads reject nonregular files without waiting for FIFO writers. A saved capture remains valid when optional later preparation expires.

State keeps six recent explicit requests and the active objective, each at most 6,000 UTF-8 bytes, below a one-megabyte serialized cap. Paths and literal symbols remain protected; exhaustive scope uses a bounded lexical rule. Known short continuations preserve the objective. CAS conflicts and interruptions leave an independent history-gap marker; configuration transitions also make continuity unknown. Ambiguous partial recovery stays baseline until a standalone explicit request restores continuity. Native compaction/resume and child identity coverage remain limited; native preparation never creates a confirmed-delivery receipt.

Private directories/files use 0700/0600. Seven-day logical expiry prevents stale continuity. Physical cleanup is opportunistic within 25 ms during enabled decision recording: it revalidates owned expired sibling state under a lock and avoids locking live sessions. Off/idle periods and large traversals have no physical deletion or progress guarantee. Corrupt state and crashed locks require deliberate recovery, never automatic takeover. Failures before a valid capture retain baseline with a generic diagnostic rather than fabricate decision metadata.

Jev receives only bounded current/active explicit text and scalar facts, never repository code or the complete conversation. Known sensitive patterns and unminimizable/history-gap state abstain. Six fixed questions, exact labels/probabilities, contradictions, executed-model identity and safe-integer usage are validated. There is at most one POST, no retries/redirects, and a one-second network/body deadline within the shared handler budget. This known-pattern guard is not universal secret detection.

The selected alias is recorded separately from each decision's actual executed model. A retained expected actual model survives local turns and failures; unexpected drift abstains. Explicit alias changes clear the old automatic expectation; admitted actual-model pins replace it, and removing a pin cannot revive an older one. Independently valid actual-model/usage metadata survives rejected answer contracts and task persistence conflicts. Missing billable usage remains unknown.

## Ownership and Failure Recovery

Linked worktrees share the primary checkout's native hook document and exclusive installer lock. Each target retains its policy, coverage, and receipt locally. Registration commands contain a stable SHA-256 target marker, distinguishing otherwise identical installations without changing hook arguments. Normalized overlap checks still reject borrowing another live registration.

Install ordering is staged ownership → initial off policy → hook mutation → receipt compaction. Pending ownership remains recoverable if a later write fails. Successful withdrawal releases obsolete ownership; distinct markers preserve another target's replacement even during pending recovery. Remove ordering is hooks → unchanged created policy → receipt. One owned instance is removed; copied or modified foreign evidence is preserved. Ambiguous modified ownership fails before writes.

Writes use exclusive temporary files, preserve existing modes, compare prior bytes, and rename atomically under the shared lock. The result reports applied files even on failure. Static directory/file symlinks are rejected for installation; removal preserves nonregular policy without reading its target. A missing source can still be removed through the recorded canonical root or original alias. The user must preserve ownership receipts and check installed references before deleting any worktree.

Mode, promotion and Jev model setup share that lock, including linked worktrees. Canonical policy output cannot exceed the runtime's 32,000-byte reader bound; stored canonical promotion reports cannot exceed 4 MB. Promotion validates the entire current policy through the runtime parser before constructing changes. A pre-write rejection preserves policy/report bytes; later partial failures retain the applied-path list. Mode changes only the global field and never create trust or qualification.

The native operations skill is an owned source symlink, not a source copy. Receipt-verified untracked managed runtime bodies are private during automatic selection; tracked, foreign and explicitly requested evidence remains available. Automatic worktree review conservatively abstains on unignored private runtime or unknown/narrowed scope. Temporary native trials use a separate expiring admission and global ownership receipt; withdrawal preserves foreign definitions.

## Exact Evidence and Recovery

Changes compare raw HEAD/index/worktree bytes; owner-execute determines canonical Git mode. Scratch no-index diffs isolate attributes, parent configuration, external conversions, lazy fetching and replacement refs. Fresh raw scratch bytes are purged before their empty directory goes to Trash; cancellation and original errors survive cleanup. Range selectors read immutable blobs. UTF-8 content and filenames preserve BOM; non-UTF8 evidence and diagnostics have labelled base64 representations.

Protected explicit paths, found imports/callers/tests/instructions and exhaustive matches cannot be removed by ranking. Literal/dynamic/external reference limits retain partial coverage. Review selection seeds dependencies from every verified changed-file page. Routine complete envelopes use whole units; omissions expose exact whole-unit cursors instead of slicing required evidence.

Schema-2 results bind their exact serialized bytes and original execution task: root/session/turn/request/epoch, permissions, source/provider versions and protected requirements. Code expansion also verifies current raw revision, inventory and corpus. Check logs describe the original execution and tolerate later repository edits within that same identity. Publication rejects identity changes rather than assigning newer provenance to old evidence. Schema-1 references require fresh selection.

Identical bytes reuse an existing validated artifact before any temporary write. New results use an exclusive private UUID temporary file, fsync and a no-clobber hard link; interrupted publication cannot poison the deterministic final name. Artifacts are regular owned 0600 files capped at 70 MB. Only the producer's temporary file is removed on completion. Native reads still return evidence: confirmed availability is required by the reuse guard, and the current client supplies no such receipt.

Seven-day logical expiry always applies. Prompt maintenance validates bounded headers and at most 1 MB of an owned expired artifact. Explicit reads recover the requested page first, then use an independent 500 ms maintenance budget to remove at most one independently verified expired sibling, including retired sessions. An explicitly requested expired artifact can be pruned separately. Prefetch performs no large sweep. Unknown partial files, active files and off/idle periods have no automatic deletion guarantee.

Declared checks run only through explicit operations and ordinary native tool permissions. Initial list admission and fresh per-member admission precede installed npm/Yarn argv execution; pnpm/Bun are conservatively unsupported. No prompt preparation executes checks. Exact stdout/stderr, observed manager exits and unsuccessful cancellation/timeout states remain visible. Captured output is bounded to 8 MB; storage failure retains execution evidence and an explicit result error. Original-task validation, fresh bounded persistence and post-execution CAS separate execution from publication. POSIX group cancellation and pipe settlement are bounded; this is not containment for escaped groups or SIGKILL. Every command rewrite remains passthrough.

## Measurement Boundary

Usage collection requires explicit session, thread, and counter-epoch identity. It keeps the final cumulative snapshot per identity, checks monotonicity, and never adds reasoning output twice. Unknown measurement remains null.

The transcript adapter supports only observed versions `0.159.2` and `0.159.3`; it reads a bounded initial-size snapshot and rejects corruption or changing metadata identity. Its CLI always reports session scope and unverified worker coverage. Manually validated worker relationships are separate evidence, not automatic complete-task discovery.

Paired promotion validates all sixty held-out identities per experiment in three variants, actual complete usage/model/effort/source, quality, order/cache records and family thresholds. Invalid rows or incomplete cohorts block qualification while original runs, valid descriptive pairs, durations and named exclusions remain visible. Only observed clients 0.159.2/0.159.3 can qualify. Hybrid additionally binds every executed Jev model and demonstrates incremental value. The policy fingerprint includes trial and shared installation dependencies; mutable modes/promotion records do not invalidate their own proof.

Seven families can hold qualification records, but only the three context recipes have automatic consumers. Manual reads/checks retain ordinary native authority; rewriting remains passthrough. Explicit component-off settings suppress automatic compositions that need them. A returned qualification status is not proof of emitted native evidence.

The complete phase-4 experiment retained 207 attempts on historical source `746478d`; billing/quality/repeat limitations yielded no promotion. Corrected-source report generation and off/uninstall smoke are separate evidence, not a new qualifying cohort. Existing trusted source registrations remain preserved and observational. See [usage](usage.md), [evaluation](evaluation.md), and [phase 4 validation](validation/phase-4.md).

## Offline Task Measurement and Diagnostics

The new response adapter is separately calibrated for 0.159.2. It binds subject thread/session/root-turn, actual context model/effort, response identities and cumulative increments. Inherited parent responses are excluded; resumed intervals subtract source-backed boundaries. Cached input and reasoning output remain included subsets. A native task-complete event proves neither exhaustive descendant discovery nor complete provider billing, so complete-task totals always remain null on this adapter.

The measurement loader resolves canonical private manifest-relative paths, rejects links/nonregular/nonprivate input, and uses one bounded descriptor snapshot per source. Ancestor device/inode identities are checked around opening and reading; this is not sandboxing against a malicious same-user swap-and-restore. Transcript admission has a 64 MB per-file and 512 MB actual aggregate-byte cap, with at most 128 captures and 128 decision sources. Stable empty, absent or malformed evidence remains unavailable while independent lower bounds survive. Unsafe path/mode/type/budget or changing-snapshot admission rejects the whole load. Exported errors and aggregate CLI diagnostics contain no private bytes or paths.

Decision descriptors bind their own path and byte hash. Native `session_hash` and `turn_hash` must match SHA-256 of admitted identities; any raw identities must agree. Verified separate decision groups contribute a lower bound even beside abandoned billing; conflicting copies contribute nothing. Neither missing audits nor zero-attempt local decisions prove task-wide zero Jev consumption.

Historical diagnostics hash original row bytes, not reserialized objects. Typed proof hashes distinguish trace, delivered evidence, scope annotation and unverified claims; their causal meaning is owner-attested. Stale, unsupported or contradictory annotations remain unknown, and original quality grades are never changed. These offline tools neither register hooks nor enable Jev. See [contracts](evaluation.md) and [validation](validation/task-measurement.md).
