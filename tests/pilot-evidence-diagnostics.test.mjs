import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { diagnosePilotEvidence } from '../src/pilot-evidence-diagnostics.mjs';
import { loadPilotEvidenceDiagnostic } from '../scripts/diagnose-pilot-evidence.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const proof = 'd'.repeat(64);
const tasks = [{ task_id: 'case', split: 'held_out', required_evidence: ['src/policy.mjs'] }];
const makeRun = (id, variant = 'baseline') => ({ run_id: id, task_id: 'case', variant, split: 'held_out',
  run_row_sha256: hash(id), quality: { evidence_complete: false, correct: true } });
const assessment = (run, cause, kind) => ({ run_id: run.run_id, task_id: run.task_id, run_row_sha256: run.run_row_sha256,
  requirement_ids: ['src/policy.mjs'], proof_sha256s: [proof], proofs: [{ sha256: proof, kind }], primary_cause: cause });
const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'evidence-diagnostics-')));
after(() => assert.equal(spawnSync('trash', [root]).status, 0));

// The source wrapper, not a mutable field in a parsed run, is the provenance authority.
test('evidence_diagnostics_use_source_hashes_and_reconcile_unknown_subsets', () => {
  const runs = ['accepted', 'missing', 'stale', 'conflict'].map(id => makeRun(id));
  const sources = runs.map(row => ({ row, run_row_sha256: hash(JSON.stringify(row) + '\n') }));
  const annotations = [assessment({ ...runs[0], run_row_sha256: sources[0].run_row_sha256 }, 'answer_omission', 'delivered_evidence'),
    assessment(runs[2], 'answer_omission', 'delivered_evidence'),
    assessment({ ...runs[3], run_row_sha256: sources[3].run_row_sha256 }, 'answer_omission', 'delivered_evidence'),
    assessment({ ...runs[3], run_row_sha256: sources[3].run_row_sha256 }, 'selection_or_delivery', 'delivery_trace')];
  const before = JSON.stringify(sources);
  const result = diagnosePilotEvidence(tasks, sources, annotations);
  assert.deepEqual(result.cause_counts, { selection_or_delivery: 0, answer_omission: 1, corpus_scope_mismatch: 0, unknown: 3 });
  assert.equal(result.unassessed_attempt_count, 1); assert.equal(result.invalid_assessment_count, 3);
  assert.equal(Object.values(result.cause_counts).reduce((a, b) => a + b, 0), 4);
  assert.equal(JSON.stringify(sources), before);
});

// Whitespace and present LF/CRLF belong to each original row hash; final EOF does not invent LF.
test('evidence_diagnostics_bind_annotations_to_exact_original_terminated_bytes', async () => {
  const task = JSON.parse((await fs.readFile('evaluation/tasks.jsonl', 'utf8')).split('\n')[0]);
  const run = { ...makeRun('BYTE_PROVENANCE_PRIVATE'), task_id: task.task_id }; delete run.run_row_sha256;
  const compact = JSON.stringify(run); const hashes = [];
  for (const [index, bytes] of [compact + '\n', '  ' + compact + '  \n', compact + '\r\n', compact].entries()) {
    const dir = join(root, 'terminator-' + index); await fs.mkdir(dir, { mode: 0o700 });
    const paths = { tasks: resolve('evaluation/tasks.jsonl'), runs: join(dir, 'runs'), assessments: join(dir, 'annotations') };
    const annotation = { ...assessment({ ...run, run_row_sha256: hash(bytes) }, 'unknown', 'unverified'),
      requirement_ids: [task.required_evidence[0]] };
    await fs.writeFile(paths.runs, bytes, { mode: 0o600 });
    await fs.writeFile(paths.assessments, JSON.stringify(annotation) + '\n', { mode: 0o600 });
    const result = await loadPilotEvidenceDiagnostic(paths);
    assert.equal(result.invalid_assessment_count, 0); assert.equal(result.details[0].annotation_accepted, true);
    hashes.push(result.details[0].run_row_sha256);
    annotation.run_row_sha256 = hash(compact + 'stale');
    await fs.writeFile(paths.assessments, JSON.stringify(annotation));
    const stale = await loadPilotEvidenceDiagnostic(paths);
    assert.equal(stale.cause_counts.unknown, 1); assert.equal(stale.unassessed_attempt_count, 0);
    assert.deepEqual(await fs.readFile(paths.runs), Buffer.from(bytes));
  }
  assert.equal(new Set(hashes).size, 4);
});

// Equal omission grades must not conflate failed delivery and a missing answer after verified delivery.
test('evidence_diagnostics_distinguish_delivery_from_answer', () => {
  const runs = [makeRun('delivery', 'deterministic'), makeRun('answer', 'hybrid')];
  const result = diagnosePilotEvidence(tasks, runs, [assessment(runs[0], 'selection_or_delivery', 'delivery_trace'),
    assessment(runs[1], 'answer_omission', 'delivered_evidence')]);
  assert.equal(result.attempt_count, 2); assert.equal(result.omission_attempt_count, 2);
  assert.equal(result.cause_counts.selection_or_delivery, 1); assert.equal(result.cause_counts.answer_omission, 1);
  assert.equal(result.unassessed_attempt_count, 0);
});

// Diagnostics retain original grades and include failed/incomplete attempts rather than regrading them.
test('evidence_diagnostics_preserve_original_grades', () => {
  const runs = [makeRun('scope'), makeRun('failed')]; runs[1].quality.correct = false;
  const before = JSON.stringify(runs);
  const result = diagnosePilotEvidence(tasks, runs, [assessment(runs[0], 'corpus_scope_mismatch', 'scope_annotation')]);
  assert.equal(result.omission_attempt_count, 2); assert.equal(result.cause_counts.corpus_scope_mismatch, 1);
  assert.equal(result.cause_counts.unknown, 1); assert.equal(result.unassessed_attempt_count, 1);
  assert.equal(JSON.stringify(runs), before);
});

// Stale hashes, missing evidence and contradictory annotations must remain unknown.
test('evidence_diagnostics_reject_stale_unsupported_and_contradictory_proofs', () => {
  const run = makeRun('PRIVATE_TRANSCRIPT_VALUE');
  for (const mutate of [a => a.run_row_sha256 = 'a'.repeat(64), a => a.primary_cause = 'magic',
    a => a.proof_sha256s = [], a => a.requirement_ids = ['foreign'], a => a.proofs[0].kind = 'scope_annotation']) {
    const a = assessment(run, 'answer_omission', 'delivered_evidence'); mutate(a);
    const result = diagnosePilotEvidence(tasks, [run], [a]);
    assert.equal(result.cause_counts.unknown, 1); assert.equal(result.invalid_assessment_count, 1);
  }
  const result = diagnosePilotEvidence(tasks, [run], [assessment(run, 'answer_omission', 'delivered_evidence'),
    assessment(run, 'selection_or_delivery', 'delivery_trace')]);
  assert.equal(result.cause_counts.unknown, 1); assert.equal(result.invalid_assessment_count, 2);
});

// Tuning is reported separately and cannot repair held-out omissions.
test('evidence_diagnostics_separate_tuning_and_unknown_quality', () => {
  const tuning = { ...makeRun('tuning'), task_id: 'tuning', split: 'tuning' };
  const unknown = makeRun('unknown'); unknown.quality.evidence_complete = null;
  const result = diagnosePilotEvidence([...tasks, { ...tasks[0], task_id: 'tuning', split: 'tuning' }], [makeRun('held'), tuning, unknown], []);
  assert.equal(result.omission_attempt_count, 1); assert.equal(result.tuning.omission_attempt_count, 1);
  assert.equal(result.unknown_quality_attempt_count, 1);
});

// CLI uses exact original row bytes, private files and aggregate-only output.
test('evidence_diagnostics_cli_preserves_private_source_bytes', async () => {
  const dir = join(root, 'cli'); await fs.mkdir(dir, { mode: 0o700 });
  const run = makeRun('PRIVATE_TRANSCRIPT_VALUE'); delete run.run_row_sha256;
  const line = '  ' + JSON.stringify(run) + '  '; const row = { ...run, run_row_sha256: hash(line) };
  const paths = { tasks: resolve('evaluation/tasks.jsonl'), runs: join(dir, 'runs.jsonl'), assessments: join(dir, 'assessments.jsonl') };
  const actual = JSON.parse((await fs.readFile(paths.tasks, 'utf8')).split('\n')[0]); run.task_id = actual.task_id;
  const actualLine = '  ' + JSON.stringify(run) + '  '; row.task_id = actual.task_id; row.run_row_sha256 = hash(actualLine + '\n');
  const a = { ...assessment(row, 'unknown', 'unverified'), requirement_ids: [actual.required_evidence[0]] };
  await fs.writeFile(paths.runs, actualLine + '\n', { mode: 0o600 });
  await fs.writeFile(paths.assessments, JSON.stringify(a) + '\n', { mode: 0o600 });
  const invoke = () => spawnSync(process.execPath, [resolve('scripts/diagnose-pilot-evidence.mjs'), '--tasks', paths.tasks,
    '--runs', paths.runs, '--assessments', paths.assessments], { encoding: 'utf8', timeout: 10000 });
  const before = await fs.readFile(paths.runs); const result = invoke(); assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout); assert.equal(output.invalid_assessment_count, 0);
  assert.ok(!(result.stdout + result.stderr).includes('PRIVATE_TRANSCRIPT_VALUE')); assert.equal(output.details, undefined);
  assert.deepEqual(await fs.readFile(paths.runs), before);
  await fs.chmod(paths.runs, 0o644); assert.equal(invoke().status, 1); await fs.chmod(paths.runs, 0o600);
  await fs.rename(paths.assessments, join(dir, 'saved')); await fs.symlink(join(dir, 'saved'), paths.assessments);
  assert.equal(invoke().status, 1);
});

// A corpus argument is a bounded regular snapshot, even before run admission.
test('evidence_diagnostics_rejects_blocking_and_oversized_corpus_arguments', async () => {
  const dir = join(root, 'corpus-bounds'); await fs.mkdir(dir, { mode: 0o700 });
  const fifo = join(dir, 'tasks-fifo'); assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
  const oversized = join(dir, 'tasks-large'); const file = await fs.open(oversized, 'w', 0o600);
  await file.truncate(4_000_001); await file.close();
  for (const tasks of [fifo, oversized]) {
    const result = spawnSync(process.execPath, [resolve('scripts/diagnose-pilot-evidence.mjs'), '--tasks', tasks,
      '--runs', join(dir, 'absent'), '--assessments', join(dir, 'absent-annotations')], { encoding: 'utf8', timeout: 1000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).available, false);
  }
});

// Module consumers must not receive JSON parser excerpts from private source rows.
test('evidence_diagnostics_exported_loader_redacts_private_parser_errors', async () => {
  const dir = join(root, 'loader-errors'); await fs.mkdir(dir, { mode: 0o700 });
  const runs = join(dir, 'runs.jsonl'); const assessments = join(dir, 'assessments.jsonl');
  await fs.writeFile(runs, 'PRIVATE_TRANSCRIPT_VALUE\n', { mode: 0o600 });
  await fs.writeFile(assessments, '{}\n', { mode: 0o600 });
  await assert.rejects(loadPilotEvidenceDiagnostic({ tasks: resolve('evaluation/tasks.jsonl'), runs, assessments }), error =>
    !error.message.includes('PRIVATE') && !error.message.includes(dir));
});

// Unknown variants remain in cohort totals without resolving inherited object members.
test('evidence_diagnostics_handles_unknown_variant_without_prototype_access', () => {
  for (const variant of ['constructor', 'toString', '__proto__']) {
    const result = diagnosePilotEvidence(tasks, [makeRun('unknown-variant', variant)], []);
    assert.equal(result.attempt_count, 1); assert.equal(result.cause_counts.unknown, 1);
    assert.equal(Object.keys(result.variant_counts).length, 3);
  }
});

// No annotations yet must retain each omitted attempt as unknown and unassessed.
test('evidence_diagnostics_accepts_empty_private_annotations', async () => {
  const dir = join(root, 'empty-annotations'); await fs.mkdir(dir, { mode: 0o700 });
  const paths = { tasks: resolve('evaluation/tasks.jsonl'), runs: join(dir, 'runs.jsonl'), assessments: join(dir, 'assessments.jsonl') };
  const task = JSON.parse((await fs.readFile(paths.tasks, 'utf8')).split('\n')[0]);
  const run = { ...makeRun('empty-annotations'), task_id: task.task_id, split: task.split };
  await fs.writeFile(paths.runs, JSON.stringify(run) + '\n', { mode: 0o600 });
  await fs.writeFile(paths.assessments, '', { mode: 0o600 });
  const result = await loadPilotEvidenceDiagnostic(paths);
  assert.equal(result.omission_attempt_count, 1); assert.equal(result.cause_counts.unknown, 1);
  assert.equal(result.unassessed_attempt_count, 1); assert.equal(result.invalid_assessment_count, 0);
});
