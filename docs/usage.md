---
read_when: Before installing, trusting, configuring, or removing the context policy.
---

# Usage and Configuration

Phase 0 establishes compatibility and measurement. The policy handler remains inert in `off`, `shadow`, and `enforce`; it does not query Jev, prepare context, rewrite commands, or run project checks. No API key is needed for this phase.

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

Modes are `off`, `shadow`, and `enforce`. `operations` is an optional object whose values use those modes; absent operations normalize to `{}`. Missing, invalid, or external configuration reads as `off`. Phase 0 implements no operation in any mode, and `jev_enabled` performs no query. There is no `mode` or `promote` management command yet; those belong to later phases.

The hook entry point is `node /absolute/context-policy/src/codex-context-policy.mjs hook`. It reads one JSON event on stdin, limits input to 1,000,000 UTF-8 bytes, and uses stderr for a generic rejected-input diagnostic without echoing input. In off mode it returns no stdout, performs no network/Git/rg work, and retains the native baseline. The config lookup uses the supplied cwd; subdirectory policies are not automatically resolved to the repository root in phase 0.

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

Never remove a source worktree while a hook refers to it. Current phase-0 runtime still uses its temporary worktree, so cleanup is retained until safe withdrawal or relocation and trust are complete. See [release procedure](RELEASING.md).
