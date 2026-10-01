---
read_when: Before installing, trusting, configuring, or removing the context policy.
---

# Usage and Configuration

Phases 0–2 establish compatibility, measurement, isolated decisions and exact expandable context. Off is inert; shadow and unpromoted enforce prepare privately without injecting evidence, rewriting commands or running checks. Optional Jev queries require an eligible safe request and a configured credential/model. The current pilot keeps Jev disabled after its negative calibration result.

## Install and Trust

Use the project's installed Node and Git. The tested environment is macOS with Node `v26.9.0`, Desktop engine `0.159.2`, and codex-tui `0.159.3`. Other environments and versions are not established by this pilot.

1. Read [native coverage evidence](validation/phase-0.md). Establish actual event coverage in the intended client before recording an event as supported.
2. At the target project's root, create `.codex/codex-context-policy-coverage.json`. For an already verified UserPromptSubmit trial, its shape is:

   ```json
   {"client_version":"0.159.2","events":{"UserPromptSubmit":"supported"}}
   ```

   The installer registers only template events explicitly marked `supported` with a string client version. Missing or unverified events remain unregistered. This record is operator-supplied evidence, not automatic runtime version enforcement.
3. From the implementation checkout, preview installation with absolute paths:

   ```sh
   rtk proxy node scripts/manage-context-policy.mjs install --repo /absolute/project --source /absolute/context-policy
   ```

4. Apply the same reviewed operation:

   ```sh
   rtk proxy node scripts/manage-context-policy.mjs install --repo /absolute/project --source /absolute/context-policy --apply
   ```

5. Inspect the native hook definition and grant trust through the current client. Desktop exposes Settings → Hooks → From Projects → Reload hooks and a per-hook Trust control. CLI exposes `/hooks`. Installation never writes native trust records.
6. Run a harmless trial in `off` and inspect failures separately from usage measurement. Repeating installation is unchanged when source, Node, coverage, and definitions match.

For a linked Git worktree, native registration and its lock live at the **primary checkout's** `.codex/hooks.json`. Policy, coverage, and ownership receipt remain local to the requested worktree. `--repo` must be the Git worktree root, not a subdirectory. A non-Git target is accepted, but its native discovery must be independently verified.

The manager pins absolute real paths for Node and source. Source movement or Node upgrades require reinstalling from the new paths and checking native trust. Source aliases are recorded for recovery; older receipts without an alias require their stored canonical source path if the source is missing.

## Local Files and Modes

| File | Purpose |
|---|---|
| `.codex/hooks.json` at the hook root | Additive native definitions; preserve foreign entries and order. |
| `.codex/codex-context-policy.json` at the target | Policy read on each call. |
| `.codex/codex-context-policy-coverage.json` at the target | Explicitly verified registration eligibility. |
| `.codex/codex-context-policy-install.json` at the target | Version-1 ownership receipt, canonical roots, original source alias, and created policy text. |
| `.codex/.codex-context-policy-install.lock` at the hook root | Exclusive shared installation lock. |

New directories use `0700`; new files use `0600`. Existing file modes are retained even under restrictive umasks. Runtime files are excluded from Git. Preserve the receipt while the installation exists.

Initial policy:

```json
{"mode":"off","jev_enabled":true}
```

Modes are `off`, `shadow`, and `enforce`. `operations` is an optional object whose values use those modes; absent operations normalize to `{}` and remain observational. Missing, invalid, external, nonregular or nonprivate policy reads as `off`. Context families are `code_context`, `code_review_context`, and `documentation_context`; both global and family mode must be enforce and current measured proof must qualify before output. The `promote` command is available; a mode-management command remains a later-phase task. No actual family is promoted.

The hook entry point is `node /absolute/context-policy/src/codex-context-policy.mjs hook`. It reads one JSON event on stdin, limits input to 1,000,000 UTF-8 bytes, and uses stderr for a generic rejected-input diagnostic without echoing input. In off mode it returns no stdout, performs no network/Git/rg work, and retains the native baseline. Installed execution requires the target's private receipt and owned native definition. The cwd must be the canonical target/worktree root; subdirectory and non-Git capture remain baseline. Automatic receipt/config/state reads reject FIFOs without waiting for writers.

## Configure Jev During Installation

From the current implementation source, use a local interactive macOS terminal:

```sh
rtk proxy node scripts/manage-context-policy.mjs install --repo /absolute/project --source /absolute/context-policy --apply --configure-jev
```

Native `security` asks for the key and confirmation with a hidden prompt. Store the API key there; do not put it in hook JSON. Setup saves it in the user Keychain under service `codex-token-efficiency.typesafe-api-key`, account `codex-token-efficiency`, retaining native access control. Neither argv nor installer output contains the key. Dry-run and noninteractive installation cannot prompt or write credentials.

Runtime and authenticated setup prefer a valid `TYPESAFE_API_KEY` in their inherited environment; otherwise they use the bounded Keychain lookup. A Desktop application may not inherit a terminal's environment. Keychain fallback avoids depending on that inheritance. Storage is shared among opted-in installations for the same user, not isolated from every other process owned by that user.

Setup discovers available models using authenticated GET `/v1/models` outside the hook's critical path. It persists only a discovered selected alias and preserves policy mode and `jev_enabled`. Configuring the key/model does not enable a promotion or change native trust. To retry discovery with the already stored key, or select a specific discovered model without another hidden prompt:

```sh
rtk proxy node src/codex-context-policy.mjs setup-jev --repo /absolute/project
rtk proxy node src/codex-context-policy.mjs setup-jev --repo /absolute/project --model discovered-model-name
```

The selected alias is `jev_model`; an optional `jev_actual_model` pins the expected executed model. Model names must be discovered rather than guessed. Selecting the same alias preserves an explicit pin; selecting another clears the stale configuration pin and session automatic expectation. A new valid observation establishes the new expectation. Same-alias unexpected drift abstains. An admitted explicit pin updates the retained expectation, so removing it cannot resurrect its predecessor. These are shadow guards, not proof of calibration.

Rerun interactive installation to rotate the stored key. Inspect only safe returned status/model metadata. Native lookup failure, missing keys, provider failure and invalid responses retain baseline; never retry a paid inference automatically. Removal leaves the shared user credential intact because other installations may use it.

## Observe Without Enabling Jev

Keep the target policy private (0600). For rule-only observation:

```json
{"mode":"shadow","jev_enabled":false,"operations":{}}
```

Edit the existing local policy while preserving any discovered model and other valid settings. Off affects the next invocation without a restart; it cannot cancel a request already sent. Enabling Jev alone grants no operation promotion, and the current calibration provides no basis to enable semantic optimization. Known local requests bypass Jev even when query observation is enabled.

Eligible queries contain current/active single-line explicit text up to 1,600 bytes each and scalar facts; the complete request including questions is capped at 6,000 UTF-8 bytes. Known secrets, sensitive prose, code, opaque tokens or missing history abstain. This is conservative known-pattern minimization, not universal secret detection. Six questions cover continuity, repository/change/documentation needs, exhaustive scope and the fixed operation choice. Uncertainty and contradictions retain baseline. At most one POST is allowed, with no retries/redirects and a one-second deadline within the two-second handler deadline.

## Private State and Recovery

State lives below `~/.codex/codex-context-policy/<repo-hash>/<session-hash>/`: `task.json`, immutable `decision-<uuid>.json` metadata and, when needed, `history-gap`. Directories are 0700; files are 0600. Recent state keeps six requests and the active explicit objective. Decision telemetry contains hashes, versions, timing and valid billing counters, never prompt text or code. Failures before validated capture produce a generic diagnostic rather than fabricated decision metadata.

Raw snapshot capture isolates global/system Git configuration while preserving effective global and repository-local ignore intent, and avoids Git clean filters. Submodules, external evidence symlinks, changed snapshots, more than 64 MB or a 1.8-second capture limit abstain. Explicit ignored paths remain retrievable. Canonical receipt ownership prevents automatic selection of untracked managed runtime contents; explicit, tracked and foreign evidence remains available. Unignored private runtime makes automatic review abstain rather than exposing its contents.

Configuration changes, conflicting writers and interrupted capture make continuity unknown. An ambiguous continuation such as “hazlo” cannot repair missing history. A standalone explicit request can restore continuity while preserving protected requirements; native compaction/resume coverage remains unverified. No delivered-context reuse is performed yet.

Seven-day logical expiry prevents stale reuse. Physical cleanup is opportunistic within 25 ms during enabled decision recording; it cannot guarantee deletion or traversal progress when off/idle or in a large directory. A corrupt state or abandoned lock keeps baseline. Before moving an affected session directory/lock to Trash, stop its writers, preserve any decision records needed for billing, and reconcile the interruption deliberately. Never clear a live lock or assume incomplete usage is zero.

## Withdraw and Recover

Preview and then apply owned removal using the same target and source:

```sh
rtk proxy node scripts/manage-context-policy.mjs remove --repo /absolute/project --source /absolute/context-policy
rtk proxy node scripts/manage-context-policy.mjs remove --repo /absolute/project --source /absolute/context-policy --apply
```

Removal withdraws one exact owned instance per receipt entry, preserves foreign additions and exact extra copies, and removes created policy text only if it is unchanged. Malformed, symlinked, and nonregular policy files are preserved while owned hooks are withdrawn. Modified owned definitions, commands, or moved events are rejected without writes; reconcile the original definition explicitly before retrying. No receipt means no owned removal.

Installation saves ownership before registering hooks and compacts it only after successful reconciliation. On a write failure, inspect the returned `changed`, `files`, and `error`: prior writes are reported, not rolled back implicitly. Retry the same operation with its receipt intact before manually changing registration. Stable per-target markers prevent recovery from deleting a different installation's replacement. An overlapping live installation is rejected; remove its owner before installing another.

A busy error identifies the exact lock path. Verify no installer is running and reconcile any interrupted operation before moving an abandoned lock to Trash. Locks never expire automatically by age. Lock-close/release failures retain a structured result with already-applied files; investigate the reported lock before retrying.

Changing this installation's hook source document can invalidate trust of other handlers in that document. In the observed client, removing the six probes changed the policy's trust to `modified`; restoring the exact authorized bytes restored trust. Coordinate registration edits with native re-trust. Temporary probes must be removed before measuring an optimization baseline.

Never remove a source worktree while a hook or installed skill refers to it. Phase-0 probes/off handler and the phase-1 policy still use their temporary sources. Phase-2 private trial fixtures also retain owned skill links and evaluation evidence. Preserve those resources until withdrawal or relocation and trust are complete. See [release procedure](RELEASING.md).

## Read Exact Context and Continue

Installation creates an owned `.agents/skills/codex-context-operations` symlink to the source skill. Existing collisions stop installation before writes; foreign replacements survive withdrawal. Resolve its physical directory to find `../../src/codex-context-policy.mjs`. These commands use ordinary Codex tool permissions and require current private task state.

| Operation | Required JSON request fields |
|---|---|
| `select_code_context` | `repo_root`, `session_id`, `paths`, `symbols`, `family`, `scope`, `exhaustive` |
| `get_repository_changes` | `repo_root`, `session_id`, `scope` |
| `read_context` | `repo_root`, `session_id`, `reference`; optional `cursor` |

Use repository/session identity from the current hook provenance. A request file for code selection can contain:

```json
{"repo_root":"/absolute/project","session_id":"current-native-session","paths":["src/entry.mjs"],"symbols":[],"family":"code_context","scope":{"kind":"worktree"},"exhaustive":false}
```

```sh
rtk proxy node /absolute/context-policy/src/codex-context-policy.mjs select_code_context < /private/request.json
rtk proxy node /absolute/context-policy/src/codex-context-policy.mjs read_context < /private/continuation.json
```

For the continuation request, set `reference` to the returned opaque `full_result` and `cursor` to `next_cursor`. Follow every page required by the task. An omission's own `cursor` requests that complete oversized unit; this explicit whole retrieval may exceed the routine 8000-byte JSON envelope. Binary files use labelled base64; binary changes preserve a base64 before/after pair. UTF-8 evidence retains BOM, CRLF and exact SHA-256. A trial may explicitly supply its isolated `state_dir`; the normal default is `~/.codex/codex-context-policy`.

Scopes are `{"kind":"worktree"}` or `{"kind":"range","base":"<full-commit-id>","head":"<full-commit-id>"}`. Range selection reads immutable target blobs. Worktree changes compare raw HEAD/index/working bytes, not filter-normalized Git status; renames may be deletion/addition. Literal references remain partial and require broader exploration. Preserve `status`, `exit_code` and `stderr`; non-UTF8 utility diagnostics are explicitly labelled base64. Missing task state, changed bytes/modes or stale epochs require ordinary exploration or fresh selection. Seven-day result expiry is logical; physical result cleanup follows phase 3.

Automatic preparation runs before generation without waiting for skill selection. It shares a two-second deadline, including the audit boundary, and at most 6000 UTF-8 bytes/approximately 2000 tokens. Explicit code paths/symbols seed code context; documentation requests seed docs/instructions. Automatic review accepts affirmative whole-worktree requests and gathers dependencies from every changed-file inventory page; narrowed, staged or range prompts conservatively retain baseline. Failed or incomplete preparation never runs checks or installs packages. Proposal metadata does not certify delivery or reusable context.

## Measure and Promote a Context Family

Use only complete actual paired evidence described in [evaluation](evaluation.md). The report command requires a private, owned, regular JSONL run file no larger than 4 MB and the exact versioned corpus:

```sh
rtk proxy node src/pilot-evaluation.mjs report --runs /private/runs.jsonl --tasks evaluation/tasks.jsonl > /private/report.json
rtk proxy node scripts/manage-context-policy.mjs promote --repo /absolute/project --report /private/report.json --family code_context --variant deterministic
```

Keep the report private (0600); append `--apply` only for a qualifying reviewed report. The manager recomputes original rows, checks current native coverage and source/model/effort versions, and stores `.codex/codex-context-promotion-<family>-<variant>.json` plus its hash in `promotions`. It sets that family's mode to enforce while preserving the global mode cap. `hybrid` requires independently useful, correctly bound actual Jev usage; disabling Jev preserves separately qualified deterministic records. The current limited experiment cannot pass these conditions, so keep global shadow and Jev disabled.

## Restricted Native Trial

The evaluator's temporary `trial` handler accepts only a frozen corpus prompt, canonical root, original HEAD, raw revision, supported client, actual model/effort and an unexpired private admission. Admission fields are `version:1`, unique `run_id`, `task_id`, `variant`, `repo_root`, `repo_revision`, `main_model`, `reasoning_effort`, `client_version`, `expires_at`; hybrid may include discovered `jev_model` and `jev_actual_model`. Expiry is at most 24 hours. Default admission is `<trial>/.codex/codex-context-trial.json`; `--admission` may name a private file in a private directory without changing the stable native command.

```sh
rtk proxy node scripts/manage-context-trial.mjs install --admission /private/trial/admission.json
rtk proxy node scripts/manage-context-trial.mjs install --admission /private/trial/admission.json --apply
rtk proxy node scripts/manage-context-trial.mjs remove --admission /private/trial/admission.json
rtk proxy node scripts/manage-context-trial.mjs remove --admission /private/trial/admission.json --apply
```

This manager adds one owned global UserPromptSubmit entry and keeps its receipt beside admission; native trust still requires Codex's normal control. Unknown model/effort or mismatched prompt/state emits nothing. It never enables production enforce. Retain attempted/failed sessions and actual whole-task usage; immutable observation timing excludes its own audit, and native wall time includes it. A transcript must separately prove exact developer evidence before generation. Withdraw the temporary entry after the experiment, preserving foreign handlers and source-document trust.
