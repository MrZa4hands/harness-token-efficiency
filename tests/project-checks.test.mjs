import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, readFile, access, symlink, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { captureContextTask, saveContextTask, readContextTask } from '../src/context-state.mjs';
import { readContext } from '../src/context-results.mjs';

const projectChecks = await import('../src/project-checks.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('/src/project-checks.mjs')) return {};
  throw error;
});
const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'project-check-tests-')));
after(() => assert.equal(spawnSync('trash', [temporaryRoot]).status, 0));
const gitEnvironment = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const diagnostic = '\uFEFFdiagnostic ☃: intentional failure\n' + 'protected failure details\n'.repeat(1000);

async function checksFixture() {
  const root = await mkdtemp(join(temporaryRoot, 'repository-'));
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, env: gitEnvironment });
  git(['-c', 'init.templateDir=', 'init', '--initial-branch=fixture-main']);
  git(['config', 'core.excludesFile', '/dev/null']); git(['config', 'core.attributesFile', '/dev/null']);
  await writeFile(join(root, '.gitignore'), '.check-*\n');
  await writeFile(join(root, 'fail.mjs'), "import {appendFileSync} from 'node:fs'; appendFileSync('.check-ran','ran\\n');\n" +
    'process.stderr.write(' + JSON.stringify(diagnostic) + ', () => process.exit(7));\n');
  await writeFile(join(root, 'empty.mjs'), 'process.exit(7);\n');
  await writeFile(join(root, 'slow.mjs'), "import {writeFileSync} from 'node:fs'; writeFileSync('.check-ready','ready');\n" +
    "process.on('SIGTERM',()=>{}); setTimeout(()=>{writeFileSync('.check-late','leaked');process.exit(0)},2000);\n");
  const manifest = { name: 'declared-check-fixture', private: true, packageManager: 'npm@11.19.1',
    scripts: { test: 'node fail.mjs', empty: 'node empty.mjs', slow: 'node slow.mjs' } };
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
  git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture: declared checks']);
  const state = await captureContextTask({ cwd: root, session_id: 'checks-session', turn_id: 'checks-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Run the declared test check.', permission_mode: 'default' }, null);
  const stateDir = join(root, '..', 'state-' + root.split('/').at(-1)); assert.equal(await saveContextTask(stateDir, state), true);
  return { root, manifest, state, stateDir, request: { repo_root: root, state_dir: stateDir, session_id: state.session_id, checks: ['test'] } };
}

// Guessing a manager, executing any unknown batch, losing exit 7 or truncating the private diagnostic breaks this owner.
test('declared_checks_preserve_failure', async () => {
  assert.equal(typeof projectChecks.runProjectChecks, 'function', 'Declared checks must preserve execution failures');
  const { root, manifest, state, request } = await checksFixture();
  assert.deepEqual(await projectChecks.detectDeclaredChecks(root), [
    { name: 'test', command: 'npm', args: ['run', 'test'] },
    { name: 'empty', command: 'npm', args: ['run', 'empty'] },
    { name: 'slow', command: 'npm', args: ['run', 'slow'] },
  ]);
  await assert.rejects(projectChecks.runProjectChecks({ ...request, checks: ['test', 'unknown'] }), /Project checks/);
  await assert.rejects(access(join(root, '.check-ran')));
  await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  await assert.rejects(projectChecks.detectDeclaredChecks(root), /Project checks.*manager/);
  await assert.rejects(projectChecks.runProjectChecks(request), /Project checks.*manager/);
  await assert.rejects(access(join(root, '.check-ran')));
  // The conflict remains on disk; do not delete it merely to reach a positive case.
  await writeFile(join(root, 'package.json'), JSON.stringify({ ...manifest, packageManager: 'pnpm@9.0.0' }));
  assert.ok((await projectChecks.detectDeclaredChecks(root)).every(check => check.command === 'pnpm'));
  const good = await checksFixture();
  const [failed] = await projectChecks.runProjectChecks(good.request);
  assert.equal(failed.exit_code, 7); assert.equal(failed.status, 'error');
  assert.ok(failed.stderr.includes('intentional failure')); assert.ok(failed.omitted_count > 0);
  assert.equal(Buffer.byteLength(JSON.stringify([failed])) <= 8000, true);
  const diagnosticPage = failed.omissions.some(item => item.path === 'stderr') ? failed :
    await readContext({ ...good.request, reference: failed.full_result, cursor: failed.next_cursor });
  const outputOmission = diagnosticPage.omissions.find(item => item.path === 'stderr'); assert.ok(outputOmission);
  const whole = await readContext({ ...good.request, reference: failed.full_result, cursor: outputOmission.cursor });
  assert.equal(whole.status, 'error'); assert.equal(whole.exit_code, 7);
  assert.ok(whole.entries[0].content.includes(diagnostic), 'All original Unicode/BOM diagnostic bytes must remain retrievable');
  assert.equal((await readFile(join(good.root, '.check-ran'), 'utf8')), 'ran\n');
  const [empty] = await projectChecks.runProjectChecks({ ...good.request, checks: ['empty'] });
  assert.equal(empty.exit_code, 7); assert.equal(empty.status, 'error');
  const cli = spawnSync(process.execPath, [resolve('src/codex-context-policy.mjs'), 'run_project_checks'],
    { input: JSON.stringify({ ...good.request, checks: ['empty'] }), encoding: 'utf8', timeout: 5000 });
  assert.equal(cli.status, 7, cli.stderr); assert.equal(JSON.parse(cli.stdout)[0].status, 'error');
  const detectedGate = await projectChecks.detectDeclaredChecks(resolve('.'));
  assert.deepEqual(detectedGate, [{ name: 'gate', command: process.execPath, args: ['scripts/verify-context-policy.mjs'] }]);
  assert.equal(state.request_hash.length, 64);
});

// Aborting npm must stop its real script descendants; a terminated process never becomes PASS.
test('project_check_cancellation_stops_descendants', async () => {
  assert.equal(typeof projectChecks.runProjectChecks, 'function');
  const { root, request } = await checksFixture();
  const controller = new AbortController();
  const running = projectChecks.runProjectChecks({ ...request, checks: ['slow'], signal: controller.signal });
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (await access(join(root, '.check-ready')).then(() => true, () => false)) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(Date.now() < deadline, 'The real declared script must start before cancellation');
  controller.abort(new Error('Operator cancelled the check.'));
  const [cancelled] = await running;
  assert.equal(cancelled.status, 'cancelled'); assert.notEqual(cancelled.exit_code, 0);
  await new Promise(resolve => setTimeout(resolve, 2100));
  await assert.rejects(access(join(root, '.check-late')), 'No script descendant may continue after cancellation');
  const [timedOut] = await projectChecks.runProjectChecks({ ...request, checks: ['slow'], timeout_ms: 100 });
  assert.equal(timedOut.status, 'timeout'); assert.notEqual(timedOut.exit_code, 0);
  const task = await readContextTask(request.state_dir, root, request.session_id);
  assert.equal(task.history_gap, false);
});

// An OS execution denial must remain denied, with the actual reason and no script side effect.
test('project_check_execution_denial_preserves_reason', async () => {
  const { root, request } = await checksFixture();
  const bin = await mkdtemp(join(temporaryRoot, 'denied-bin-'));
  await writeFile(join(bin, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o600 });
  await symlink('/usr/bin/git', join(bin, 'git'));
  const cli = spawnSync(process.execPath, [resolve('src/codex-context-policy.mjs'), 'run_project_checks'],
    { input: JSON.stringify(request), env: { ...gitEnvironment, PATH: bin }, encoding: 'utf8', timeout: 5000 });
  assert.notEqual(cli.status, 0);
  const denied = JSON.parse(cli.stdout)[0]; assert.equal(denied.status, 'denied');
  assert.match(denied.error, /EACCES/); assert.notEqual(denied.exit_code, 0);
  await assert.rejects(access(join(root, '.check-ran')));
});

// Serialized output must fit private storage; exceeding the capture ceiling must never be reported as PASS.
test('project_check_output_limit_is_explicit_and_recoverable', async () => {
  const { root, request, manifest } = await checksFixture();
  await writeFile(join(root, 'large.mjs'), 'process.stdout.write(Buffer.alloc(9_000_000), () => process.exit(0));\n');
  await writeFile(join(root, 'package.json'), JSON.stringify({ ...manifest, scripts: { large: 'node large.mjs' } }));
  const previous = await readContextTask(request.state_dir, root, request.session_id);
  const task = await captureContextTask({ cwd: root, session_id: request.session_id, turn_id: 'large-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Run the declared large check.', permission_mode: 'default' }, previous);
  assert.equal(await saveContextTask(request.state_dir, task), true);
  const [limited] = await projectChecks.runProjectChecks({ ...request, checks: ['large'] });
  assert.equal(limited.status, 'error'); assert.equal(limited.output_complete, false);
  assert.equal(limited.error, 'output-limit-exceeded'); assert.notEqual(limited.exit_code, 0);
  const recovery = await readContext({ ...request, reference: limited.full_result, cursor: limited.omissions[0].cursor });
  assert.equal(recovery.output_complete, false); assert.equal(recovery.status, 'error');
  assert.ok(recovery.entries[0].content.includes('\0'.repeat(1000)));
  const repositories = await readdir(request.state_dir); const sessions = await readdir(join(request.state_dir, repositories[0]));
  const artifact = join(request.state_dir, repositories[0], sessions[0], 'result-' + limited.full_result + '.json');
  assert.ok((await stat(artifact)).size < 70_000_000);
});
