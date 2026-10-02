import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectCodexUsage, validatePilotCorpus, materializePilotFixture } from '../src/pilot-evaluation.mjs';

const temporaryRoot = await mkdtemp(join(tmpdir(), 'context-evaluation-tests-'));
after(() => assert.equal(spawnSync('trash', [temporaryRoot]).status, 0));

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

// The observed CLI version must measure its matching envelope while unknown versions abstain.
test('observed_cli_01593_usage_remains_version_limited', async () => {
  assert.equal(collectCodexUsage([event(80), event(80), event(130)], '0.159.3').total_tokens, 150);
  const root = await mkdtemp(join(temporaryRoot, 'context-usage-01593-'));
  const path = join(root, 'session.jsonl');
  const lines = [{ type: 'session_meta', payload: { id: 'main', cli_version: '0.159.3' } },
    ...[80, 80, 130].map(input => ({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage(input) } } }))];
  await writeFile(path, lines.map(value => JSON.stringify(value)).join('\n') + '\n');
  const run = version => spawnSync(process.execPath, [resolve('src/pilot-evaluation.mjs'), 'usage', '--transcript', path, '--client-version', version], { encoding: 'utf8' });
  const measured = run('0.159.3');
  assert.equal(measured.status, 0);
  assert.equal(JSON.parse(measured.stdout).total_tokens, 150);
  assert.equal(JSON.parse(measured.stdout).worker_coverage_verified, false);
  assert.equal(run('0.159.2').status, 1);
  assert.equal(collectCodexUsage([event(80)], '0.159.4').total_tokens, null);
});

// CLI must report unknown instead of printing source content or guessing client versions.
test('transcript_reader_recovers_trailing_line_and_rejects_corruption', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'context-usage-'));
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
  for (const fragment of ['{"invalid":]', '{"bad":00', '{"unicode":"\\uXX', '{"literal":truX']) {
    await writeFile(path, lines + fragment);
    const malformed = run();
    assert.equal(malformed.status, 1, 'Impossible JSON prefixes must not become recovered usage');
    assert.equal(JSON.parse(malformed.stdout).total_tokens, null);
    assert.equal(malformed.stdout.includes(fragment), false);
    assert.equal(malformed.stderr.includes(fragment), false);
  }
});

// A live append after the size/last-byte check must not change the measured snapshot.
test('transcript_reader_bounds_a_growing_file_to_its_initial_size', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'context-growing-transcript-'));
  const path = join(root, 'session.jsonl');
  const program = resolve('src/pilot-evaluation.mjs');
  const metadata = { type: 'session_meta', payload: { id: 'main', cli_version: '0.159.2' } };
  const count = input => ({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage(input) } } });
  await writeFile(path, [metadata, count(130)].map(value => JSON.stringify(value)).join('\n') + '\n');
  const injected = `import fs from 'node:fs/promises'; import { syncBuiltinESMExports } from 'node:module';
    import { pathToFileURL } from 'node:url'; const originalOpen = fs.open;
    fs.open = async (...args) => { const handle = await originalOpen(...args); const originalRead = handle.read.bind(handle);
      handle.read = async (...readArgs) => { const result = await originalRead(...readArgs);
        await fs.appendFile(args[0], ${JSON.stringify(JSON.stringify(count(230)) + '\n')}); return result; }; return handle; };
    syncBuiltinESMExports(); const program = process.argv[1]; const transcript = process.argv[2];
    process.argv = [process.execPath, program, 'usage', '--transcript', transcript, '--client-version', '0.159.2'];
    await import(pathToFileURL(program).href);`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', injected, program, path], { encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.equal(JSON.parse(child.stdout).total_tokens, 150);
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
  const fixture = JSON.parse(await readFile(resolve('evaluation/pilot-fixture.json'), 'utf8'));
  const declaredChecks = JSON.parse(fixture.files['package.json']).scripts;
  assert.ok(tasks.every(task => task.expected_checks.every(check => Object.hasOwn(declaredChecks, check))),
    'Required checks must use declared project check identities, with exact scope in the outcome assertions');

});

// Real fixture materialization proves repository size and executable indirect calls.
test('pilot_fixture_is_reproducible_and_has_real_indirect_dependencies', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'context-pilot-fixture-'));
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
  const second = await mkdtemp(join(temporaryRoot, 'context-pilot-fixture-'));
  assert.equal((await materializePilotFixture(second)).initial_revision, materialized.initial_revision);
  await assert.rejects(() => materializePilotFixture(root), /empty/);
  const poisoned = await mkdtemp(join(temporaryRoot, 'context-pilot-environment-'));
  const isolated = spawnSync(process.execPath, [resolve('src/pilot-evaluation.mjs'), 'fixture', '--repo', poisoned], {
    encoding: 'utf8', env: { ...process.env, GIT_DIR: join(second, '.git'), GIT_WORK_TREE: second },
  });
  assert.equal(isolated.status, 0);
  assert.equal(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: second, encoding: 'utf8' }).stdout.trim(), materialized.initial_revision);
  const gitHome = await mkdtemp(join(temporaryRoot, 'context-xdg-git-'));
  await mkdir(join(gitHome, 'git'));
  await writeFile(join(gitHome, 'git/ignore'), 'package-lock.json\n');
  const ignoredRoot = await mkdtemp(join(temporaryRoot, 'context-pilot-ignore-'));
  const ignored = spawnSync(process.execPath, [resolve('src/pilot-evaluation.mjs'), 'fixture', '--repo', ignoredRoot], {
    encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: gitHome },
  });
  assert.equal(ignored.status, 0);
  assert.equal(JSON.parse(ignored.stdout).initial_revision, materialized.initial_revision, 'Ambient Git ignore files must not change the fixture');
  await writeFile(join(gitHome, 'git/attributes'), '*.mjs working-tree-encoding=UTF-16\n');
  const attributedRoot = await mkdtemp(join(temporaryRoot, 'context-pilot-attributes-'));
  const attributed = spawnSync(process.execPath, [resolve('src/pilot-evaluation.mjs'), 'fixture', '--repo', attributedRoot], {
    encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: gitHome },
  });
  assert.equal(attributed.status, 0, 'Ambient Git attributes must not change file encoding');
  assert.equal(JSON.parse(attributed.stdout).initial_revision, materialized.initial_revision);
  const changed = await mkdtemp(join(temporaryRoot, 'context-pilot-changes-'));
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
  const root = await mkdtemp(join(temporaryRoot, 'context-gate-'));
  const environment = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  assert.equal(spawnSync('git', ['-c', 'init.templateDir=', 'init', '--initial-branch=fixture-base'], { cwd: root, env: environment, encoding: 'utf8' }).status, 0);
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
  await writeFile(path, "import test from 'node:test'; test('valid isolated check', () => {});\n");
  await mkdir(join(root, 'evaluation'));
  for (const file of ['tasks.jsonl', 'pilot-fixture.json']) await copyFile(resolve('evaluation', file), join(root, 'evaluation', file));
  await writeFile(join(root, 'README.md'), '[External skill](/unavailable-context-policy-host/SKILL.md)\n');
  const portable = spawnSync(process.execPath, [gate], { cwd: root, encoding: 'utf8' });
  assert.equal(portable.status, 0, 'Unavailable external references must not break a portable repository gate');
  assert.match(portable.stderr, /external reference/i);
  const isolatedCheck = "import test from 'node:test'; import {open,unlink} from 'node:fs/promises'; " +
    "test('isolated deadline worker', async () => { const file = await open('active-check-worker', 'wx'); " +
    "try { await new Promise(resolve => setTimeout(resolve, 300)); } finally { await file.close(); await unlink('active-check-worker'); } });\n";
  for (const name of ['first-worker.test.mjs', 'second-worker.test.mjs']) await writeFile(join(root, 'tests', name), isolatedCheck);
  const isolated = spawnSync(process.execPath, [gate], { cwd: root, encoding: 'utf8' });
  assert.equal(isolated.status, 0, 'Deadline-sensitive test files must run in isolated workers: ' + isolated.stderr);
  await writeFile(join(root, 'README.md'), '[Required local document](missing-required.md)\n');
  const localLink = spawnSync(process.execPath, [gate], { cwd: root, encoding: 'utf8' });
  assert.equal(localLink.status, 1);
  assert.match(localLink.stderr, /Broken local document link/);
});
