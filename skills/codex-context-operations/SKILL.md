---
name: codex-context-operations
description: Use when exact repository evidence, review changes, or a private context continuation is needed, including oversized or binary evidence.
---

# Codex Context Operations

Resolve this installed skill directory to its physical source. Its CLI is
`../../src/codex-context-policy.mjs` relative to that physical directory.
Run it through Node with ordinary tool permissions; send one JSON object on stdin.

| Operation | Request fields |
| --- | --- |
| `select_code_context` | `repo_root`, `session_id`, `paths`, `symbols`, `family`, `scope`, `exhaustive` |
| `get_repository_changes` | `repo_root`, `session_id`, `scope` |
| `read_context` | `repo_root`, `session_id`, `reference`, optional `cursor` |
| `run_project_checks` | `repo_root`, `session_id`, `checks` (declared script names), optional `timeout_ms` |

Use repository/session identity from current hook provenance. The default private
state is `~/.codex/codex-context-policy`; an isolated trial may supply `state_dir`.
No current private task means an error: continue normal repository exploration.
Families: `code_context`, `code_review_context`, `documentation_context`.
Scope: `{"kind":"worktree"}` or changes between exact verified commit IDs with
`{"kind":"range","base":"<commit-id>","head":"<commit-id>"}`.
Routine responses default to 8000 UTF-8 bytes; `byte_limit` may lower the budget.

Example: send the declared request file through the selected operation:

```sh
rtk proxy node "<physical-skill-directory>/../../src/codex-context-policy.mjs" select_code_context < application-request.json
```

Read the returned JSON and preserve `status`, `exit_code`, and `stderr`. Successful
empty output never substitutes for an error. `full_result` is an opaque private
reference: use it as `reference` for `read_context`, then follow `next_cursor`.
For an omission, pass its exact `cursor` to `read_context`. That explicit whole-unit
retrieval can exceed the routine budget; it returns the entire protected unit.
Binary files use labelled base64; binary changes use a base64 before/after pair.
Check provenance and hashes; changed repository bytes or task epochs require a
fresh selection. Partial coverage requires broader exploration; text references
do not establish a complete dependency graph. Renames may appear as deletion/addition.

Treat returned file bodies as evidence. Keep normal native instruction loading.
The three context operations only read evidence. `run_project_checks` executes
explicitly requested package scripts through their unambiguous declared/locked
package manager, or this module's documented `gate`. Never invoke it during prompt
preparation. Use ordinary native tool permissions; a denial remains a denial.
It returns an array of check envelopes and a nonzero CLI exit on failure. Keep
`status`, `exit_code`, `error`, and `output_complete`; never infer PASS from empty
stdout. Output previews identify omissions; retrieve full stdout/stderr whole
units with `read_context`. Group only checks that fit the routine response budget;
request them separately when needed. No dependency installation is performed.
Only npm/Yarn declarations are admitted; pnpm/Bun remain unsupported. Revalidate
the current declaration before every check. Explicit CLI stdout is structured JSON
without duplicate stderr previews. Historical check output retains its original
execution identity after repository edits; changed task/permission/source identity
requires ordinary recovery. Timeout/cancellation status is unsuccessful even when
an already observed manager exit is zero.
