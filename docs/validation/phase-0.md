---
read_when: Before resuming phase 0 or assessing compatibility evidence.
---

# Phase 0 Validation

- Starting develop SHA: `f416fd89797281294c08e0062d95c5aeeba17880`
- Worktree: `/Users/mrz/Documents/Roe/tools/LifeOS/codex-token-efficiency-worktrees/phase-0`
- Feature branch: `feat/codex-token-efficiency-phase-0`
- Remote: `https://github.com/MrZa4hands/harness-token-efficiency.git`
- PR base: `develop`
- Execution method: native inline execution.
- Remote synchronization: `develop...origin/develop` = `0 0` before worktree creation.
- Baseline: five documentation files, no implementation, dependencies, or test gate.

## Versions

- node: `v26.9.0`
- codex: `codex-cli 0.159.2`
- git: `git version 2.54.0 (Apple Git-157)`
- rg: `ripgrep 14.1.1`
- rtk: `rtk 0.49.0`

## Compatibility

All runtime paths start unverified and disabled. The installed CLI's version alone does not prove current-interface coverage. Native trust must be granted through the client; no trust records or bypass flags are written.

| Path | App status | CLI status |
|---|---|---|
| UserPromptSubmit | unverified | unverified |
| Direct Bash PreToolUse/PostToolUse | unverified | unverified |
| Nested tools | unverified | unverified |
| Local MCP | unverified | unverified |
| Hosted MCP | unverified | unverified |
| Persistent commands | unverified | unverified |
| PostCompact | unverified | unverified |
| SessionStart/resume | unverified | unverified |
| SessionEnd | unverified | unverified |

## Progress

Task 0A started. Reviews, release documentation, PR, and merge remain pending.

## Task 0A RED/GREEN

- Initial interface stubs produced three behavioral assertion failures: installation results missing, invalid configuration did not normalize to off, and unverified event registration absent.
- Temporary compatibility probe first failed its marker assertion, then passed with hash-only event logs.
- `rtk proxy node --test tests/hook-installation.test.mjs`: 4 passed, 0 failed.
- `rtk proxy git diff --check`: exit 0.
- Existing hooks retain order, unknown handlers, metadata, and file permissions. Dry run writes nothing; repeat install is unchanged; removal preserves later foreign additions.
- Production installation filters events through project-local verified coverage; no coverage means no registered optimizer handlers.
- Native probe definition: `.codex/hooks.json` in the primary checkout. The probe source and private log remain in the implementation worktree. Runtime registration is ignored locally; no native trust changes or bypass flags were applied.

## Native Probe Procedure

Use the current interface and its unchanged model/effort in this worktree. Restart the CLI after registration. Review the primary checkout's exact `.codex/hooks.json` definition in the native hook browser and authorize it there. For CLI, use `/hooks`; open `UserPromptSubmit`, select the new hook whose command contains `tests/context-hook-probe.mjs`, and use the displayed trust control after review. Repeat for the other probe events.

Submit: `Report the compatibility probe marker from hook context exactly, or say absent. Do not read any files or invoke tools.` Compare the answer with the private expected marker in this plan's scratch workspace; the prompt itself does not contain the marker.

Then request a harmless direct `pwd` command, and separately nested tool execution, an existing persistent command session, and MCP calls when available. Inspect only event names/hashes/time from `.codex/context-hook-probe.jsonl`; transcript text is never copied into the log.

Manually compact and resume the same session using the client's supported controls. Record observed events and unsupported/unverified paths. SessionEnd requires actually ending the main session. Disable or remove probe definitions after the test; do not mark production coverage supported from unit tests or version detection alone.

Native coverage, trust, and current-interface task usage remain unverified; Task 0A is not complete.

### Linked Worktree Discovery Correction

On 2026-10-01, CLI 0.159.2 reproduced Roe's missing-hook report in a fresh `--no-daemon` session with the phase-0 worktree as cwd. The native `config/read` API reported an enabled project layer, but `hooks/list` omitted all six worktree-local probe definitions. Adding an empty worktree `config.toml` did not change discovery; that diagnostic file was moved to Trash.

Registering the same probe definitions at the primary checkout's `.codex/hooks.json` made all six appear in `hooks/list`, each with `trustStatus: untrusted`, without warnings or errors. The actual CLI startup then showed `Hooks need review` and `6 hooks are new or changed`. `/hooks` showed `UserPromptSubmit` with three installed, two active, and one pending review; its new `Hook 1` identified the primary checkout source and the worktree probe command. No inference or trust approval was performed during this discovery check.

This installed CLI resolves native hook registration through the primary checkout for linked worktrees. Registration there is runtime state permitted by AGENTS.md; implementation source remains in the feature worktree. The manager's project-local target must follow this observed installation location; do not infer that a successful write to a linked worktree is discoverable. Runtime event execution and App discovery remain unverified. The original worktree-only trust instructions were incorrect.

## Usage Source Reconnaissance

Read metadata and token-counter shapes from twelve recent local session logs without printing, exporting, or retaining conversation content. Observed versions include CLI 0.159.2 and Desktop 0.155.0-alpha.16.4. Six token fields are present: input, cached input, cache-write input, output, reasoning output, and total. No cumulative decreases appeared in this small inspection. Worker inclusion, counter epochs, and the current interface's version remain unverified; this is source discovery, not complete task measurement.

## Checkpoint

Node syntax, configuration JSON, and the 500-line file limit checks passed. Task 0A remains incomplete pending native trust and real-client integration. No PR review, merge, promotion, or token-savings claim has occurred. The feature commit is a resumable checkpoint; later phases have not started.

## Task 0B Checkpoint

Roe uses both Codex App and CLI. Maintain independent coverage and client-version evidence; CLI evidence never proves App support. The native probe has not produced a real-client log yet.

- Version-limited cumulative usage collector: supplied thread/session/epoch identities are required, duplicate snapshots count once, explicitly separated epochs add, unexplained counter decreases become unknown. Output includes reasoning; do not add reasoning twice. Missing/invalid/unsupported values remain null.
- Read-only transcript CLI streams events, suppresses transcript content, recovers only an unterminated final JSON fragment, rejects interior corruption and mismatched metadata versions. Its measured scope is session, not complete task; worker coverage remains false.
- A real observed 0.159.2 session was read successfully: adapter exit 0 and counters available. No transcript or exact private-session totals were copied into repository artifacts. Complete-task and worker-inclusive usage remain unverified.
- Corpus: 60 held-out cases (ten per category) and six distinct tuning conversations. Each pins revision, fixture hash/state, expected checks, required evidence, and independently annotated outcome assertions. The reproducible fixture has 533 tracked files, an executable indirect dependency chain, Unicode/newline names, staged/unstaged changes, rename, deletion, untracked addition, and a declared long-stderr exit-7 check. Human assessment of assertions remains part of pilot evaluation; these cases are not measured runs.
- Synthetic fixture Git processes isolate inherited Git environment/configuration, use fixed identity/date and an empty destination, and preserve the same baseline SHA across separate roots and dirty profiles. No dependency installation, paid inference, or extra server is needed.
- RED observed before implementation: usage collector, transcript CLI, missing corpus, fixture materialization, and gate failure detection. Regression RED observed for unstaged rename identification and inherited Git directory redirection; both are green after owner-boundary corrections.
- `rtk proxy node scripts/verify-context-policy.mjs`: exit 0; nine tests pass. Syntax, JSON/JSONL, corpus, local document links, 500-line limit, and repository scope checks pass. External sibling reference links resolve from the primary checkout under AGENTS.md. Node test engine markers are removed for fresh check subprocesses, so nested checks execute rather than silently skip.

Tasks 0A and 0B remain incomplete pending native dual-client integration and complete-task measurement validation. Phase 0 has no PR yet; both mandated reviews, release documentation, and merge remain pending. No subsequent phase or optimizer promotion has begun.
