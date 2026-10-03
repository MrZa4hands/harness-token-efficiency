---
summary: Documentation and workflow for the Codex token-efficiency module.
read_when: Before analyzing the module, reviewing its specification, or preparing an implementation plan.
---

# Codex Token Efficiency

Research and design for reducing tokens in Codex through automation, inspired by LifeOS and Jev.

Phases 0–4 provide native hook installation, version-limited usage measurement, a reproducible pilot corpus, isolated task state, bounded Jev decisions, exact expandable evidence, identical-result storage reuse, explicitly requested declared checks, seven-family qualification and immediate mode control. Automatic context preparation remains in shadow until a family passes the paired evaluation. Read [AGENTS.md](AGENTS.md) before planning or implementation.

This directory is an independent Git repository, initialized on October 1, 2026. LifeOS remains sibling reference material; its former parent Git metadata was moved to Trash.

| Document | Contents | When to read |
|---|---|---|
| [Required workflow](AGENTS.md) | Skills, worktree from develop, TDD, two review stages, documentation, merge, and safe cleanup. | Before every plan or implementation. |
| [Pilot specification](docs/codex-token-efficiency-spec.md) | Current-interface design, automatic decisions, contracts, coverage, evaluation, and five phases. | Before reviewing the design or preparing the implementation plan. |
| [Implementation plan](docs/plans/2026-09-30-codex-token-efficiency.md) | Five sequential PRs, TDD tasks, integration, evaluation, and the complete delivery lifecycle. | Before reviewing the plan or executing a phase. |
| [Initial research](docs/codex-token-efficiency-proposal.md) | Jev and Glance analysis, code findings, harness limitations, and candidate measures. | For evidence and design background. |
| [Usage and configuration](docs/usage.md) | Installation, native trust, configuration, withdrawal, and recovery. | Before installing or removing hooks. |
| [Architecture](docs/architecture.md) | Current modules, ownership, and measurement boundaries. | Before changing the implementation. |
| [Evaluation](docs/evaluation.md) | Usage contracts, fixture, corpus, and measurement limitations. | Before collecting or comparing usage. |
| [Task measurement plan](docs/plans/2026-10-03-task-measurement-and-evidence-diagnostics.md) | Native intervals, private offline measurement, historical diagnostics and delivery sequence. | Before extending task accounting or preparing a new experiment. |
| [Task measurement validation](docs/validation/task-measurement.md) | Native parent/worker/resume evidence, all 189 historical capture checks, omission causes and both reviews. | Before interpreting task totals or the Jev comparison. |
| [Phase 0 validation](docs/validation/phase-0.md) | Native observations, TDD, reviews, and delivery evidence. | Before assessing compatibility or resuming delivery. |
| [Phase 1 validation](docs/validation/phase-1.md) | State/credential regressions, actual calibration, both reviews, and limits. | Before assessing shadow decisions or configuring Jev. |
| [Phase 2 validation](docs/validation/phase-2.md) | Exact retrieval, native preparation, both reviews, actual experiments and limits. | Before assessing context delivery or promotion. |
| [Phase 3 validation](docs/validation/phase-3.md) | Storage reuse, historical check recovery, both reviews, final-source native integration and limits. | Before assessing check execution or reuse. |
| [Phase 4 validation](docs/validation/phase-4.md) | Complete native experiment, conservative qualification, both reviews and withdrawal evidence. | Before assessing activation or savings claims. |
| [Release procedure](docs/RELEASING.md) | Required checks, merge, and safe cleanup. | Before closing a phase PR. |
| [Changelog](CHANGELOG.md) | Pilot capabilities and limitations. | Before using a new phase. |

Roe authorized the five-phase plan. Phases 0–4 are merged into develop through PRs #1–5. The operations skill exposes `select_code_context`, `get_repository_changes`, `read_context`, and `run_project_checks`; private whole-unit continuations preserve required evidence. Identical reads reuse storage and still return content. Native delivery suppression and command rewriting remain disabled. No operation is promoted and no general token saving is claimed.

The phase-4 experiment retained 207 native attempts: 18 tuning, 180 primary and nine repeats. Of 189 held-out/repeated attempts, 185 completed and 179 answered correctly; 47 omitted required evidence and two left checks incomplete or broadened their scope. Complete provider/worker billing remains unknown. These results do not qualify a family; Jev stays disabled. See [evaluation](docs/evaluation.md) for sample sizes, failures and measurement limits.

Jev credentials can be configured during installation through a hidden macOS Keychain prompt: `install --configure-jev --apply`. Credentials stay out of hook JSON and Git; environment credentials take precedence. See [setup and recovery](docs/usage.md). Actual tuning/held-out observations accepted no semantic proposals at the tested threshold, so the pilot keeps Jev disabled. Corrective replay retained 19 correct local proposals out of 60 cases; this is not savings evidence.

PR #6 adds offline task measurement and independent omission diagnostics. Its comparison keeps three treatments: reference baseline, deterministic rules without Jev, and hybrid rules with Jev where a recorded query actually occurred. All 189 historical captures were checked; 187 have verified final-turn Codex lower bounds. Complete task/provider coverage remains unknown. Separate annotations identify 21 scope mismatches and 26 unknown causes among the original 47 omissions. See [measurement and diagnostics](docs/evaluation.md).

PR #7 extends those offline tools to explicitly declared multi-turn tasks, bounded streaming and exact original-row hashes including line terminators. Optional diagnostic `--output` saves run-level details to a new private file while stdout remains aggregate-only. Conflicted, disconnected or cyclic worker ancestry contributes no tokens or provider decisions. This follow-up replays archived calibration and diagnostics; it adds no hook installation, paid cohort or optimizer activation. See [usage](docs/usage.md) and [follow-up validation](docs/validation/task-measurement.md).

The delivery remote is `https://github.com/MrZa4hands/harness-token-efficiency.git`; implementation PRs target `develop`. Phases 0–4 use PRs #1–5. Run the standard-library gate from this checkout:

```sh
rtk proxy node scripts/verify-context-policy.mjs
```

The corrected follow-up source passes 215 tests plus syntax, JSON/corpus, document links, and source-scope checks. Deadline-sensitive test files run serially; production deadlines are unchanged. Native compatibility is separately recorded in the validation documents; tests alone cannot establish client coverage.
