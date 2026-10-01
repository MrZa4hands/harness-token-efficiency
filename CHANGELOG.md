---
read_when: Before assessing the capabilities of the current pilot phase.
---

# Changelog

## Unreleased

### Phase 0 — Compatibility and Baseline

- Install and withdraw an inert native Codex hook while preserving existing handlers, configuration, and file modes. Linked worktrees register at the primary checkout; ownership survives interrupted writes and distinguishes replacement installations. See [installation and recovery](docs/usage.md).
- Measure supported session usage without duplicate cumulative counters or double-counted reasoning. Unsupported/corrupt input stays unknown; automatic worker/task-wide measurement remains unavailable. See [evaluation](docs/evaluation.md).
- Validate 60 held-out and six tuning cases against a reproducible 533-file synthetic repository and executable checks.
- Verify actual pre-prompt marker delivery in Desktop engine 0.159.2 and codex-tui 0.159.3, plus CLI nested/persistent tool observations and separate worker counter relationships. Unobserved paths remain disabled; native trust remains user-controlled.
- Run a standard-library gate with 36 passing tests, syntax, JSON/corpus, document links, and source-scope checks. Both mandated review stages completed and all confirmed findings were corrected.
- No context optimization, Jev inference, promotions, or token savings is activated or claimed. Temporary native registrations still require safe withdrawal/relocation before source-worktree cleanup.
