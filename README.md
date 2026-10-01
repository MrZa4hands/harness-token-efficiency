---
summary: Documentation and workflow for the Codex token-efficiency module.
read_when: Before analyzing the module, reviewing its specification, or preparing an implementation plan.
---

# Codex Token Efficiency

Research and design for reducing tokens in Codex through automation, inspired by LifeOS and Jev.

This module contains the project documents and will contain its implementation, tests, and plans. Read [AGENTS.md](AGENTS.md) before planning or implementation.

This directory is an independent Git repository, initialized on October 1, 2026. LifeOS remains sibling reference material; its former parent Git metadata was moved to Trash.

| Document | Contents | When to read |
|---|---|---|
| [Required workflow](AGENTS.md) | Skills, worktree from develop, TDD, two review stages, documentation, merge, and safe cleanup. | Before every plan or implementation. |
| [Pilot specification](docs/codex-token-efficiency-spec.md) | Current-interface design, automatic decisions, contracts, coverage, evaluation, and five phases. | Before reviewing the design or preparing the implementation plan. |
| [Implementation plan](docs/plans/2026-09-30-codex-token-efficiency.md) | Five sequential PRs, TDD tasks, integration, evaluation, and the complete delivery lifecycle. | Before reviewing the plan or executing a phase. |
| [Initial research](docs/codex-token-efficiency-proposal.md) | Jev and Glance analysis, code findings, harness limitations, and candidate measures. | For evidence and design background. |

The specification and plan await review. Roe requested this plan; the mechanisms remain unimplemented and token savings have not been measured.

Execution requires an explicitly established develop branch and delivery remote. Neither is configured in this new repository.
