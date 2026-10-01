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
These operations only read evidence; project checks are not available here.
