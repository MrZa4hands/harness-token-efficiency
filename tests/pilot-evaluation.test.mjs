import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectCodexUsage, validatePilotCorpus, materializePilotFixture } from '../src/pilot-evaluation.mjs';

const usage = (input, output = 20, reasoning = 5) => ({
  input_tokens: input, cached_input_tokens: 10, cache_write_input_tokens: 0,
  output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output,
});
const event = (input, thread = 'main', epoch = '0') => ({
  session_id: thread, thread_id: thread, counter_epoch: epoch, usage: usage(input),
});
const task = (id, conversation, split = 'held_out') => ({
  task_id: id, conversation_id: conversation, split, category: 'code_analysis',
  initial_revision: 'e570601c0d7defbec8b3e79fdc707e491e751f84',
  prompt: 'Explain malformed configuration fallback in src/codex-context-policy.mjs.',
  expected_checks: [], required_evidence: ['src/codex-context-policy.mjs'],
  expected_outcome: { assertions: ['Malformed configuration returns off.'] },
});

// A sum of cumulative events, reasoning, or duplicate thread snapshots inflates billing.
test('usage_totals_and_corpus', () => {
  const totals = collectCodexUsage([event(80), event(80), event(130)], '0.159.2');
  assert.equal(totals.available, true);
  assert.equal(totals.total_tokens, 150);
  assert.equal(totals.output_tokens, 20);
  assert.equal(totals.reasoning_output_tokens, 5);
  assert.equal(collectCodexUsage([event(80), event(30, 'worker')], '0.159.2').total_tokens, 150);
  assert.equal(collectCodexUsage([event(80), event(30, 'main', 'verified-reset-1')], '0.159.2').total_tokens, 150);
  for (const events of [[], [event(80), event(30)], [{ ...event(80), usage: { ...usage(80), output_tokens: -1 } }],
    [{ ...event(80), usage: { ...usage(80), total_tokens: 500 } }]]) {
    const unknown = collectCodexUsage(events, '0.159.2');
    assert.equal(unknown.available, false);
    assert.equal(unknown.total_tokens, null);
  }
  assert.equal(collectCodexUsage([event(80)], 'unknown').available, false);
  assert.equal(collectCodexUsage([event(80)], '0.155.0-alpha.16.4').available, false);
  const unsafeSplit = [task('one', 'conversation-A'), task('two', 'conversation-A', 'tuning')];
  assert.equal(validatePilotCorpus(unsafeSplit).valid, false);
  assert.ok(validatePilotCorpus(unsafeSplit).errors.some(error => error.includes('conversation')));
  assert.equal(validatePilotCorpus([task('one', 'conversation-A'), task('one', 'conversation-B')]).valid, false);
  assert.equal(validatePilotCorpus([{ ...task('one', 'A'), required_evidence: ['../secret'] }]).valid, false);
});

// CLI must report unknown instead of printing source content or guessing client versions.
test('transcript_reader_recovers_trailing_line_and_rejects_corruption', async () => {
  const root = await mkdtemp(join(tmpdir(), 'context-usage-'));
  const path = join(root, 'session.jsonl');
  const metadata = { type: 'session_meta', payload: { id: 'main', cli_version: '0.159.2' } };
  const count = input => ({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage(input) } } });
  const privateEvent = { type: 'response_item', payload: { content: 'PRIVATE_TRANSCRIPT_VALUE' } };
  const lines = [metadata, privateEvent, count(80), count(80), count(130)].map(value => JSON.stringify(value)).join('\n') + '\n';
  await writeFile(path, lines + '{"incomplete');
  const run = () => spawnSync(process.execPath, [resolve('src/pilot-evaluation.mjs'), 'usage', '--transcript', path, '--client-version', '0.159.2'], { encoding: 'utf8' });
  const recovered = run();
  assert.equal(recovered.status, 0);
  assert.equal(JSON.parse(recovered.stdout).total_tokens, 150);
  assert.match(recovered.stderr, /incomplete final line/);
  assert.match(recovered.stderr, /worker coverage/);
  assert.equal(recovered.stdout.includes('PRIVATE_TRANSCRIPT_VALUE'), false);
  assert.equal(recovered.stderr.includes('PRIVATE_TRANSCRIPT_VALUE'), false);
  await writeFile(path, lines.replace(JSON.stringify(privateEvent), '{INVALID_JSON}') );
  const corrupt = run();
  assert.equal(corrupt.status, 1);
  assert.equal(JSON.parse(corrupt.stdout).available, false);
  assert.equal(JSON.parse(corrupt.stdout).total_tokens, null);
  await writeFile(path, lines.replace('"cli_version":"0.159.2"', '"cli_version":"0.155.0-alpha.16.4"'));
  const mismatched = run();
  assert.equal(mismatched.status, 1);
  assert.equal(JSON.parse(mismatched.stdout).available, false);
  assert.match(mismatched.stderr, /version/);
});

test('held_out_corpus_has_sixty_verifiable_cases_and_separate_tuning', async () => {
  const path = resolve('evaluation/tasks.jsonl');
  const exists = await readFile(path, 'utf8').then(text => text, () => '');
  const tasks = exists.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const result = validatePilotCorpus(tasks);
  assert.equal(result.valid, true, result.errors?.join('\n') ?? 'Corpus validation missing');
  const heldOut = tasks.filter(task => task.split === 'held_out');
  assert.equal(heldOut.length, 60);
  for (const category of ['code_analysis', 'review', 'documentation', 'checks', 'follow_up', 'exhaustive']) {
    assert.equal(heldOut.filter(task => task.category === category).length, 10);
  }
  assert.ok(tasks.some(task => task.split === 'tuning'));

});

// Real fixture materialization proves repository size and executable indirect calls.
test('pilot_fixture_is_reproducible_and_has_real_indirect_dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'context-pilot-fixture-'));
  const materialized = await materializePilotFixture(root);
  assert.equal(typeof materialized?.initial_revision, 'string');
  const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(git(['rev-parse', 'HEAD']).stdout.trim(), materialized.initial_revision);
  const corpus = (await readFile(resolve('evaluation/tasks.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(corpus.every(task => task.initial_revision === materialized.initial_revision && task.fixture.sha256 === materialized.fixture_sha256));
  const inventory = git(['ls-files', '-z']).stdout.split('\0').filter(Boolean);
  assert.ok(inventory.length >= 500);
  const chain = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import { summarizeIssues } from './src/issue-report.mjs'; console.log(JSON.stringify(summarizeIssues([{id:7,label:' High Priority ',state:'open'}])));"], { cwd: root, encoding: 'utf8' });
  assert.equal(chain.status, 0);
  assert.deepEqual(JSON.parse(chain.stdout), [{ id: 7, label: 'high-priority' }]);
  const second = await mkdtemp(join(tmpdir(), 'context-pilot-fixture-'));
  assert.equal((await materializePilotFixture(second)).initial_revision, materialized.initial_revision);
  await assert.rejects(() => materializePilotFixture(root), /empty/);
  const poisoned = await mkdtemp(join(tmpdir(), 'context-pilot-environment-'));
  const isolated = spawnSync(process.execPath, [resolve('src/pilot-evaluation.mjs'), 'fixture', '--repo', poisoned], {
    encoding: 'utf8', env: { ...process.env, GIT_DIR: join(second, '.git'), GIT_WORK_TREE: second },
  });
  assert.equal(isolated.status, 0);
  assert.equal(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: second, encoding: 'utf8' }).stdout.trim(), materialized.initial_revision);
  const changed = await mkdtemp(join(tmpdir(), 'context-pilot-changes-'));
  const result = await materializePilotFixture(changed, 'changes');
  assert.equal(result.initial_revision, materialized.initial_revision);
  const status = spawnSync('git', ['status', '--porcelain=v1'], { cwd: changed, encoding: 'utf8' }).stdout;
  assert.match(status, /M  src\/label-policy.mjs/);
  assert.match(status, / M src\/issue-search.mjs/);
  assert.match(status, /\?\? src\/new-report.mjs/);
  assert.match(status, /R  src\/legacy-report.mjs -> src\/export-report.mjs/);
});

// The gate must execute checks, rather than infer success from an empty command output.
test('verification_gate_reports_syntax_and_behavior_failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'context-gate-'));
  spawnSync('git', ['init', '--initial-branch=fixture-base'], { cwd: root, encoding: 'utf8' });
  await import('node:fs/promises').then(fs => fs.mkdir(join(root, 'tests')));
  const path = join(root, 'tests/broken.test.mjs');
  const gate = resolve('scripts/verify-context-policy.mjs');
  await writeFile(path, 'export const invalid = ;\n');
  const syntax = spawnSync(process.execPath, [gate], { cwd: root, encoding: 'utf8' });
  assert.equal(syntax.status, 1);
  assert.match(syntax.stdout + syntax.stderr, /SyntaxError/);
  await writeFile(path, "import test from 'node:test'; test('deliberate gate failure', () => { throw new Error('required check failure'); });\n");
  const behavioral = spawnSync(process.execPath, [gate], { cwd: root, encoding: 'utf8' });
  assert.equal(behavioral.status, 1);
  assert.match(behavioral.stdout + behavioral.stderr, /required check failure/);
});
