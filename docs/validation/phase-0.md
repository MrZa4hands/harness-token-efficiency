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
| UserPromptSubmit | supported: Desktop 0.159.2 | supported: codex-tui 0.159.3 and codex_exec 0.159.2 |
| Direct Bash PreToolUse/PostToolUse | unverified | unavailable in the observed codex_exec tool inventory; other sessions unverified |
| Nested tools | unverified | Bash via custom exec observed: codex-tui 0.159.3 and codex_exec 0.159.2 |
| Local MCP | unverified | unverified |
| Hosted MCP | unverified | unverified |
| Persistent commands | unverified | observed: codex_exec 0.159.2, nested TTY command and stdin continuation |
| PostCompact | unverified | unverified |
| SessionStart/resume | startup observed; resume unverified | startup observed; resume unverified |
| SessionEnd | unverified | observed: codex-tui 0.159.3, codex-tui 0.159.2, and codex_exec 0.159.2 |

## Progress

Tasks 0A and 0B are implemented and validated for the observed paths. PR #1 targets develop; both mandated review stages completed, all confirmed findings were corrected, and release documentation was added. Final merge and cleanup status are recorded by the PR and execution ledger. No optimizer is activated.

## Task 0A RED/GREEN

- Initial interface stubs produced three behavioral assertion failures: installation results missing, invalid configuration did not normalize to off, and unverified event registration absent.
- Temporary compatibility probe first failed its marker assertion, then passed with hash-only event logs.
- Initial task-0A checkpoint: `rtk proxy node --test tests/hook-installation.test.mjs` reported 4 passed, 0 failed; subsequent review regressions increase the current suite below.
- `rtk proxy git diff --check`: exit 0.
- Existing hooks retain order, unknown handlers, metadata, and file permissions. Dry run writes nothing; repeat install is unchanged; removal preserves later foreign additions.
- Production installation filters events through project-local verified coverage; no coverage means no registered optimizer handlers.
- Native probe definition: `.codex/hooks.json` in the primary checkout. The probe source and private log remain in the implementation worktree. Runtime registration is ignored locally; no native trust changes or bypass flags were applied.

## Native Probe Procedure

Use the current interface and its unchanged model/effort in this worktree. Restart the CLI after registration. Review the primary checkout's exact `.codex/hooks.json` definition in the native hook browser and authorize it there. For CLI, use `/hooks`; open `UserPromptSubmit`, select the new hook whose command contains `tests/context-hook-probe.mjs`, and use the displayed trust control after review. Repeat for the other probe events.

Submit: `Report the compatibility probe marker from hook context exactly, or say absent. Do not read any files or invoke tools.` Compare the answer with the private expected marker in this plan's scratch workspace; the prompt itself does not contain the marker.

Then request a harmless direct `pwd` command, and separately nested tool execution, an existing persistent command session, and MCP calls when available. Inspect only event names/hashes/time from `.codex/context-hook-probe.jsonl`; transcript text is never copied into the log.

Manually compact and resume the same session using the client's supported controls. Record observed events and unsupported/unverified paths. SessionEnd requires actually ending the main session. Disable or remove probe definitions after the test; do not mark production coverage supported from unit tests or version detection alone.

Coverage is partial. Native trust and the observed paths below are confirmed; remaining interface paths and automatic complete-task usage remain unverified. Only verified events may be registered for the policy.

### Linked Worktree Discovery Correction

On 2026-10-01, CLI 0.159.2 reproduced Roe's missing-hook report in a fresh `--no-daemon` session with the phase-0 worktree as cwd. The native `config/read` API reported an enabled project layer, but `hooks/list` omitted all six worktree-local probe definitions. Adding an empty worktree `config.toml` did not change discovery; that diagnostic file was moved to Trash.

Registering the same probe definitions at the primary checkout's `.codex/hooks.json` made all six appear in `hooks/list`, each with `trustStatus: untrusted`, without warnings or errors. The actual CLI startup then showed `Hooks need review` and `6 hooks are new or changed`. `/hooks` showed `UserPromptSubmit` with three installed, two active, and one pending review; its new `Hook 1` identified the primary checkout source and the worktree probe command. No inference or trust approval was performed during this discovery check.

This installed CLI resolves native hook registration through the primary checkout for linked worktrees. Registration there is runtime state permitted by AGENTS.md; implementation source remains in the feature worktree. The manager's project-local target must follow this observed installation location; do not infer that a successful write to a linked worktree is discoverable. The original worktree-only trust instructions were incorrect.

### Native Probe Result

Roe supplied the successful marker response on 2026-10-01. Private native session metadata identifies the matching session as `codex-tui`, version `0.159.3`, source `vscode`, with cwd at the phase-0 worktree. This identifies the observed runtime; it does not establish desktop coverage.

The original user prompt contained no marker. At 09:13:45 UTC, the transcript recorded hook context carrying the expected marker in a developer message after `UserPromptSubmit`. The assistant returned it at 09:13:48 UTC without a tool call in that turn. The private probe log independently recorded `SessionStart` and `UserPromptSubmit`. This establishes context delivery before generation for that client version. Neither the transcript, private session identifiers, nor raw prompts were copied into repository artifacts.

Later records in the same session include matched `PreToolUse` and `PostToolUse` events while the transcript records custom `exec` calls containing nested `tools.exec_command` invocations. The single-call and parallel three-call cases match the corresponding hook event counts. This establishes observational nested Bash coverage for this CLI session, not argument rewriting. A preceding session with the same client metadata also recorded `SessionEnd`. Direct Bash, resume, compaction, persistent commands, and MCP paths remain unverified.

The installed desktop application is version `26.928.21956`; its bundled engine reports `0.159.2`. Its native `hooks/list` discovers all six probe definitions as trusted without warnings or errors. Installed settings components expose Hooks, From Projects, Reload hooks, and per-hook Trust controls. No trust records were written by the agent.

Roe repeated the marker test in the desktop application. The matching private session identifies `Codex Desktop`, engine `0.159.2`, and the phase-0 worktree. At 09:25:33 UTC, its user prompt contained no marker, the following developer hook context supplied it, and the assistant returned it at 09:25:38 UTC without a tool call. The private probe log independently records `SessionStart` and `UserPromptSubmit`. Desktop context delivery before generation is verified. The existing usage adapter reads all six counters from that actual session with exit 0 and available totals; measurement scope remains session and worker coverage remains false.

### Linked Worktree Installer Regression

The installer now resolves a linked worktree's primary checkout using Git's registered worktree inventory. It registers hooks and acquires its installation lock at the primary checkout, while keeping policy, verified coverage, and its ownership receipt local to the requested worktree. Foreign definitions at either location remain untouched. The receipt binds the actual hook root; incompatible prior receipts fail closed. Git-specific inherited environment variables cannot redirect discovery. Missing primary paths and symlinked installation directories are rejected.

`linked_worktree_install_uses_primary_hook_registration` failed first with `1 !== 2`: the primary hook list remained unchanged while the installer wrote into the linked worktree. After the correction, the real Git worktree test verifies dry-run preservation, additive registration, off mode, repeat installation, and owned removal without changing either root's foreign definitions.

A separate temporary fixture could not establish native discovery because Codex rejected its untrusted project layer. No project or hook trust was fabricated; its owned trial registration was removed. A subsequent trial in the already-trusted project added one verified UserPromptSubmit policy handler in off mode. Desktop engine `hooks/list` found it at the primary checkout as untrusted. Owned removal preserved the existing probe definitions and policy; temporary coverage was moved to Trash. No inference or native trust approval was performed during these installation checks.

The optimizer remains off; no token savings or complete phase-0 coverage is claimed.

### Native CLI Tool and Worker Probe

A separate cold CLI 0.159.2 session ran the user-shell command `!rtk proxy pwd` and ended successfully. The probe recorded SessionEnd but no Bash tool hooks or SessionStart. User-shell commands are distinct from model tool calls; this path is not covered by the observed Bash hook registration. Startup coverage must not be inferred for empty or shell-only sessions.

A subsequent read-only `codex exec` session, version 0.159.2, ran two nested `tools.exec_command` directory checks and exactly one worker directory check. The actual parent and worker turn contexts confirm inherited model and effort. Both threads completed. A persistent TTY command printed `probe-ready`, accepted `probe-input` through stdin continuation, printed `probe-ok`, and exited 0. The parent's private probe log records SessionStart, UserPromptSubmit, four matched PreToolUse/PostToolUse pairs, and SessionEnd. A direct command tool was absent from this session's available inventory; no direct-tool coverage is inferred. The client's existing under-development feature warning did not prevent successful completion; no warning suppression or client settings were changed.

The parent contains six usage records and the worker two, each with distinct response identities. Records preserve separate thread identities, a shared root session and root turn, and all six usage fields. For each thread, summed response increments exactly match its final thread cumulative usage and token_count total. Supplying these verified separate thread snapshots to `collectCodexUsage` returns the sum of both final totals without duplication. No private identities, transcript content, or exact totals are exported here.

Automatic worker discovery remains unimplemented. The worker transcript also contains inherited parent metadata and task-start history, so the conservative single-session transcript reader rejects its changing identity rather than attributing those counters incorrectly. This manual validation establishes the observed counter relationships; it does not make the CLI's session-only output complete-task measurement or permit promotion.

### Native Policy Trust and Off Trial

After the verified marker and installer checks, the manager installed the real UserPromptSubmit handler at the primary checkout in mode `off`. Coverage permits only that event for the observed Desktop and codex_exec 0.159.2 clients; other policy events remain unregistered. The six temporary probe definitions are preserved. Policy and ownership receipt stay in the phase-0 worktree.

The desktop engine's native `hooks/list` initially discovered the real handler from the primary checkout with command ending `src/codex-context-policy.mjs' hook` and trust status `untrusted`. Roe then authorized this distinct command through the native client. A fresh discovery request confirms exactly one policy handler with status `trusted` and the expected primary source. No trust state was written by the agent; discovery performs no inference.

A subsequent actual CLI 0.159.2 `codex_exec` trial in the phase-0 worktree completed successfully with the exact requested reply, no tool calls, and mode still `off`. The private probe log records SessionStart, UserPromptSubmit, and SessionEnd for that trial; stderr contains no hook failure or untrusted-hook diagnostic. The CLI does not export an isolated completion record for the silent policy handler, so this is a trusted native off-mode installation trial, not per-handler telemetry. The installed source still refers to the temporary worktree, so cleanup is unsafe until registration is safely relocated or removed.

Phase-0 completion ruling: the specification's compatibility matrix permits unsupported/unverified paths to stay disabled, and its usage contract permits indicators when complete-task measurement is unavailable. The implemented deliverables establish actual pre-prompt delivery in both interfaces, additive installation and native trust, version-limited real usage, independent worker counter validation, and the initial corpus. Automatic worker discovery and unobserved paths remain explicit limitations; neither token promotion nor savings claims are permitted. The PR lifecycle below follows this integration checkpoint; phase 1 starts only after the phase-0 merge.

## Usage Source Reconnaissance

Initial reconnaissance, before the native trials above: metadata and token-counter shapes from twelve recent local session logs were read without printing, exporting, or retaining conversation content. Observed versions included CLI 0.159.2 and Desktop 0.155.0-alpha.16.4. Six token fields were present: input, cached input, cache-write input, output, reasoning output, and total. No cumulative decreases appeared in that small inspection. Worker inclusion, counter epochs, and the current interface's version were then unverified; this was source discovery, not complete task measurement.

## Checkpoint

At the earlier checkpoint, node syntax, configuration JSON, and the 500-line file limit checks passed while native installation was incomplete and no PR review had occurred. The subsequent evidence closes that installation check; the review/delivery section below records later progress. Later phases, promotions, and token-savings measurements have not started.

## Task 0B Checkpoint

Roe uses both Codex App and CLI. Maintain independent coverage and client-version evidence; CLI evidence never proves App support. Native probe logs now exist for the sessions described above. Both observed versions, `0.159.2` and `0.159.3`, now have version-limited usage support. Other versions still report unknown totals.

- Version-limited cumulative usage collector: supplied thread/session/epoch identities are required, duplicate snapshots count once, explicitly separated epochs add, unexplained counter decreases become unknown. Output includes reasoning; do not add reasoning twice. Missing/invalid/unsupported values remain null.
- Read-only transcript CLI streams events, suppresses transcript content, recovers only an unterminated final JSON fragment, rejects interior corruption and mismatched metadata versions. Its measured scope is session, not complete task; worker coverage remains false.
- A real observed 0.159.2 session was read successfully: adapter exit 0 and counters available. No transcript or exact private-session totals were copied into repository artifacts. Complete-task and worker-inclusive usage remain unverified.
- Corpus: 60 held-out cases (ten per category) and six distinct tuning conversations. Each pins revision, fixture hash/state, expected checks, required evidence, and independently annotated outcome assertions. The reproducible fixture has 533 tracked files, an executable indirect dependency chain, Unicode/newline names, staged/unstaged changes, rename, deletion, untracked addition, and a declared long-stderr exit-7 check. Human assessment of assertions remains part of pilot evaluation; these cases are not measured runs.
- Synthetic fixture Git processes isolate inherited Git environment/configuration, use fixed identity/date and an empty destination, and preserve the same baseline SHA across separate roots and dirty profiles. No dependency installation, paid inference, or extra server is needed.
- RED observed before implementation: usage collector, transcript CLI, missing corpus, fixture materialization, and gate failure detection. Regression RED observed for unstaged rename identification and inherited Git directory redirection; both are green after owner-boundary corrections.
- At this task-0B checkpoint, `rtk proxy node scripts/verify-context-policy.mjs` exited 0 with nine passing tests. Syntax, JSON/JSONL, corpus, local document links, 500-line limit, and repository scope checks passed. External sibling references resolved from the primary checkout under AGENTS.md. Node test engine markers are removed for fresh check subprocesses, so nested checks execute rather than silently skip.

Tasks 0A and 0B met the limited compatibility and measurement deliverables at this pre-PR checkpoint. Reviews, release documentation, and merge were then pending. No subsequent phase or optimizer promotion had begun.

## Updated Verification

- The real CLI 0.159.3 source contains thirteen cumulative counter events matching the same validated six-field contract, with no unexplained decrease. Its adapter support first failed the regression assertion `null !== 150`, then passed after adding this exact observed version. Metadata/version mismatches and unseen versions still fail closed. Its real session adapter returns available session totals with worker coverage false.
- At the native-installation checkpoint, eleven tests plus syntax, JSON/corpus, document links, and source scope passed. No raw transcript, session identities, or exact private-session totals were exported into repository artifacts.
- Parent/worker counters were validated against a real completed native CLI task. Automatic task-wide discovery remains unverified, and session-only CLI reports retain worker coverage false.
- The real off-mode policy handler is natively trusted and its actual CLI installation trial completes without tools or hook diagnostics. Remaining integration paths stay unverified and disabled; token savings are unmeasured.

## Trust Snapshot and Retained Installation

An attempted withdrawal of the six probes changed the primary hook source document and made the real policy handler `modified`, despite its unchanged command. The exact authorized source bytes were restored without writing trust state; fresh native discovery again returned six trusted probes and one trusted policy handler. The probes therefore remain registered. Their removal requires coordinated source editing and native re-trust before optimization-baseline measurements.

The trusted runtime definition still uses the earlier, unmarked command at the temporary phase-0 source. The reviewed installer now generates stable per-target command-comment markers and supports upgrading the version-1 receipt; applying that upgrade changes the native definition and requires checking trust. No upgrade was applied to the authorized runtime snapshot during the review fixes. Retain the worktree and feature branches until active/installed references are safely withdrawn or relocated.

## Required Reviews and Corrections

PR #1 base is develop, starting at `f416fd89797281294c08e0062d95c5aeeba17880`.

First review used the exact required `$review`. Core checklist, six applicable specialists, red-team, fresh native adversarial review, and both actual Claude Code adversarial/structured passes completed. Actual reported provider identity was `claude-opus-5-5`; usage/model metadata remained private. Native fixture/test payload inspection was summary-only and was not claimed complete raw-payload review. The installed skill lacks the referenced quality-score formula, so the score remained unavailable rather than invented.

All confirmed first-stage findings were corrected through behavioral regressions. Its final coverage completed, but `converged:false` and three fix cycles were retained because the last captured pass required corrections. No fourth pass or replacement token was fabricated. Corrections were committed and pushed as `36b8742` after the skill returned.

Second review used `$superpowers:requesting-code-review` with a fresh reviewer and the complete actual range `f416fd89797281294c08e0062d95c5aeeba17880..36b87427402883bdf4a8693c0d02c9dad31eca9a`. The reviewer read source, callers, tests, templates, fixture, corpus, plan, and public evidence. It found one additional ownership defect: edited commands or moved events escaped the original-event/exact-command check. The regression first returned `error:null`; marker-aware detection across all events now rejects those mutations without changing hooks, policy, or receipt. Correction `b4eabf3` was committed and pushed after targeted GREEN and the complete gate.

Both independent review stages are finished. Every confirmed finding is resolved; no reviewer was restarted after stage two. Documentation follows the explicit project override, with no independent documentation reviewer.

| Correction boundary | Runnable evidence |
|---|---|
| Durable ownership and truthful partial writes | `installation_write_failures_preserve_ownership_and_allow_recovery` |
| Coverage withdrawal, final compaction failure/retry, foreign re-addition | `installation_reconciles_revoked_coverage_without_orphaning_hooks` |
| Pending A receipt preserves replacement B | `pending_withdrawal_cannot_delete_another_worktree_registration` |
| Source disappearance/alias and unrelated-source rejection | `missing_source_removal_accepts_recorded_alias_only`; canonical-source regression |
| Modified definitions, exact extra copies, edited commands, moved events | `modified_owned_definition_is_preserved_and_exact_foreign_copy_survives`; `edited_owned_commands_and_moved_events_preserve_receipt_until_reconciled` |
| Invalid/external policy withdrawal and structured lock-release failure | recovery tests for both boundaries |
| Native root, receipt mismatch, symlink metadata, inherited Git routing | `installation_identity_and_git_discovery_boundaries_fail_closed`; Git-subdirectory regression |
| Literal source characters, umask, symlink CLI, unrelated import arguments | installer path/mode and recovery CLI regressions |
| UTF-8 chunk boundaries and private diagnostics | `hook_stdin_preserves_split_utf8_characters`; malformed-config regression |
| Corrupt tails and bounded growing transcript snapshots | transcript-reader regressions |
| Ambient Git hooks/excludes/attributes and declared corpus check identities | fixture/corpus and nested linked-worktree test regressions |
| Portable external references with strict internal links | verification-gate regression |

Disposition evidence: deleting a worktree/receipt before checking installed references violates the mandatory cleanup procedure, so no orphan-source ledger was added. Duplicate JSON-key/unsafe-number claims lacked verified native effective-handler evidence; supported JSON value semantics remain the boundary, with no custom parser. A corpus-shaped failure response for a non-corpus command was not a breach of a promised fixture-error schema: fixture materialization rejects with a nonzero CLI exit. No speculative abstraction was added for those claims. Remaining native/model/worker limitations remain explicit rather than silently classified as coverage.

## Final Phase-0 Gate and Delivery

- Full gate after both stages and their corrections: 36 passed, 0 failed, 0 skipped; syntax, JSON/corpus, internal document links, file limits, and source scope pass.
- `rtk proxy git diff --check`: exit 0.
- Test-owned temporary roots move to Trash; Git test processes isolate ambient hooks/templates/configuration.
- Public release docs describe only shipped phase-0 behavior. There is no VERSION file, release tag, or dependency/linter/typechecker configuration to bump or simulate.
- At PR inspection, GitHub reported no checks and no CI runs. No configured CI is recorded as absent, not green. Final-head checks/protections and the merged SHA must be verified during delivery.
- Merge targets develop without protection bypass. Cleanup remains unsafe while native commands refer to the phase-0 worktree; preserve its local/remote branch and worktree until trust-aware relocation or removal.
