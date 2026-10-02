import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access, symlink, stat, readdir, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { captureContextTask, saveContextTask, readContextTask } from '../src/context-state.mjs';
import { readContext } from '../src/context-results.mjs';

const projectChecks = await import('../src/project-checks.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('/src/project-checks.mjs')) return {};
  throw error;
});
import { checksFixture, refreshChecksFixture, projectCheckTemporaryRoot as temporaryRoot,
  projectCheckGitEnvironment as gitEnvironment, projectCheckDiagnostic as diagnostic } from './project-checks.fixture.mjs';

// Publication must not bless an earlier execution with a concurrently changed turn or permission identity.
test('check_publication_rejects_changed_execution_identity', async () => {
  const fixture = await checksFixture();
  const diagnostic = 'Executed under the original permission identity.\n';
  await writeFile(join(fixture.root, 'delayed.mjs'), "import {writeFileSync,existsSync} from 'node:fs';writeFileSync('.check-ready','ready');" +
    "const timer=setInterval(()=>{if(existsSync('.check-continue')){clearInterval(timer);process.stderr.write(" +
    JSON.stringify(diagnostic) + ");process.exitCode=7}},10);\n");
  await writeFile(join(fixture.root, 'package.json'), JSON.stringify({ ...fixture.manifest, scripts: { delayed: 'node delayed.mjs' } }));
  await refreshChecksFixture(fixture);
  const before = await readContextTask(fixture.stateDir, fixture.root, fixture.state.session_id);
  const running = projectChecks.runProjectChecks({ ...fixture.request, checks: ['delayed'], timeout_ms: 5000 });
  try {
    const deadline = Date.now() + 4000;
    while (!await access(join(fixture.root, '.check-ready')).then(() => true, () => false)) {
      assert.ok(Date.now() < deadline, 'Declared check must actually start');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const changed = await captureContextTask({ cwd: fixture.root, session_id: before.session_id, turn_id: 'new-turn',
      hook_event_name: 'UserPromptSubmit', prompt: before.active_request.text, permission_mode: 'restricted',
      versions: { ...before.versions, policy: 'changed-policy' } }, before);
    assert.equal(changed.request_hash, before.request_hash); assert.equal(changed.context_epoch, before.context_epoch);
    assert.equal(await saveContextTask(fixture.stateDir, changed), true);
  } finally { await writeFile(join(fixture.root, '.check-continue'), 'continue'); }
  const [result] = await running;
  assert.equal(result.exit_code, 7); assert.match(result.stderr, /original permission identity/);
  assert.match(result.result_error ?? '', /persistence|binding|state/);
  assert.equal(result.full_result, null); assert.equal(result.entries.find(entry => entry.stream === 'stderr').content, diagnostic);
});

// A small accepted batch budget must retain every actual exit and whole diagnostic instead of throwing after execution.
test('storage_failure_preserves_real_retrieval_keyword_diagnostics', async () => {
  for (const cancelled of [false, true]) {
    const fixture = await checksFixture(); const controller = new AbortController();
    const diagnosis = 'retrieval checksum failed: actual cause ABC123\n';
    await writeFile(join(fixture.root, 'keywords.mjs'), 'process.stderr.write(' + JSON.stringify(diagnosis + 'detail\n'.repeat(2000)) +
      ");" + (cancelled ? "import {writeFileSync} from 'node:fs';writeFileSync('.check-ready','ready');setInterval(()=>{},100);\n" : 'process.exitCode=7;\n'));
    await writeFile(join(fixture.root, 'package.json'), JSON.stringify({ ...fixture.manifest, scripts: { keywords: 'node keywords.mjs' } }));
    await refreshChecksFixture(fixture);
    const directories = await readdir(fixture.stateDir); const sessions = await readdir(join(fixture.stateDir, directories[0]));
    const directory = join(fixture.stateDir, directories[0], sessions[0]); await chmod(directory, 0o500);
    try {
      const running = projectChecks.runProjectChecks({ ...fixture.request, checks: ['keywords'], signal: controller.signal, timeout_ms: 5000 });
      if (cancelled) {
        const deadline = Date.now() + 4000;
        while (!await access(join(fixture.root, '.check-ready')).then(() => true, () => false)) {
          assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10));
        }
        controller.abort(new Error('retrieval stopped by the caller'));
      }
      const [result] = await running;
      assert.ok(result.stderr.startsWith(diagnosis), 'A real diagnostic is not a synthetic retrieval instruction');
      if (cancelled) assert.equal(result.error, 'retrieval stopped by the caller');
      else assert.equal(result.exit_code, 7);
    } finally { await chmod(directory, 0o700); }
  }
});

// Cancellation stops execution but must still finalize all bytes already captured in healthy private storage.
test('cancelled_check_retains_captured_large_diagnostic', async () => {
  const fixture = await checksFixture(); const controller = new AbortController();
  const content = 'Captured before cancellation.\n' + 'detail\n'.repeat(1500);
  await writeFile(join(fixture.root, 'capture.mjs'), "import {writeFileSync} from 'node:fs';process.stderr.write(" +
    JSON.stringify(content) + ",()=>writeFileSync('.check-ready','ready'));setInterval(()=>{},100);\n");
  await writeFile(join(fixture.root, 'package.json'), JSON.stringify({ ...fixture.manifest, scripts: { capture: 'node capture.mjs' } }));
  await refreshChecksFixture(fixture);
  const running = projectChecks.runProjectChecks({ ...fixture.request, checks: ['capture'], signal: controller.signal, timeout_ms: 5000 });
  const deadline = Date.now() + 4000;
  while (!await access(join(fixture.root, '.check-ready')).then(() => true, () => false)) {
    assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10));
  }
  controller.abort(new Error('Capture finished; execution cancelled.'));
  const [result] = await running;
  assert.equal(result.status, 'cancelled'); assert.equal(result.exit_code, 130);
  assert.match(result.full_result ?? '', /^[a-f0-9]{64}$/);
  const recovered = await readContext({ ...fixture.request, reference: result.full_result, cursor: result.full_result + ':whole:1' });
  assert.equal(recovered.entries[0]?.content, content); assert.equal(recovered.exit_code, 130);
});

// EOF held by an escaped watcher must not replace the manager's already observed exit with a timeout exit.
test('pipe_timeout_preserves_observed_manager_exit', async () => {
  const fixture = await checksFixture();
  await writeFile(join(fixture.root, 'exit-with-watcher.mjs'), "import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';" +
    "const child=spawn(process.execPath,['-e','setTimeout(()=>{},3000)'],{detached:true,stdio:'inherit'});" +
    "writeFileSync('.check-watcher-pid',String(child.pid));process.stderr.write('Original exit seven\\n',()=>process.exit(7));\n");
  await writeFile(join(fixture.root, 'package.json'), JSON.stringify({ ...fixture.manifest, scripts: { watched: 'node exit-with-watcher.mjs' } }));
  await refreshChecksFixture(fixture);
  try {
    const [result] = await projectChecks.runProjectChecks({ ...fixture.request, checks: ['watched'], timeout_ms: 1000 });
    assert.equal(result.exit_code, 7); assert.equal(result.status, 'timeout'); assert.equal(result.output_complete, false);
    assert.match(result.stderr, /Original exit seven/);
  } finally {
    const pid = Number(await readFile(join(fixture.root, '.check-watcher-pid'), 'utf8'));
    try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
});

// Managers with unverified automatic bootstrap must abstain before invoking any declared user script.
test('declared_checks_abstain_for_unverified_no_install_managers', async () => {
  const fixture = await checksFixture();
  for (const packageManager of ['pnpm@10.9.0', 'bun@1.3.5']) {
    await writeFile(join(fixture.root, 'package.json'), JSON.stringify({ ...fixture.manifest, packageManager }));
    await assert.rejects(projectChecks.detectDeclaredChecks(fixture.root), /unsupported.*no-install|no-install.*unsupported/);
    const cli = spawnSync(process.execPath, [resolve('src/codex-context-policy.mjs'), 'run_project_checks'],
      { input: JSON.stringify(fixture.request), encoding: 'utf8' });
    assert.equal(cli.status, 1); assert.match(JSON.parse(cli.stdout).stderr, /unsupported.*no-install/);
    await assert.rejects(access(join(fixture.root, '.check-ran')));
  }
});

// A small accepted batch budget must retain every actual exit and whole diagnostic instead of throwing after execution.
test('grouped_check_previews_preserve_results_within_response_budget', async () => {
  const fixture = await checksFixture();
  const stdout = 'stdout diagnosis ' + 'x'.repeat(1050) + '\n';
  const stderr = 'stderr diagnosis ' + 'y'.repeat(1050) + '\n';
  await writeFile(join(fixture.root, 'both.mjs'), `process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)}); process.exitCode=7;\n`);
  await writeFile(join(fixture.root, 'package.json'), JSON.stringify({ ...fixture.manifest,
    scripts: Object.fromEntries(['one', 'two', 'three', 'four'].map(name => [name, 'node both.mjs'])) }));
  await refreshChecksFixture(fixture);
  let results;
  await assert.doesNotReject(async () => { results = await projectChecks.runProjectChecks({ ...fixture.request, checks: ['one', 'two', 'three', 'four'] }); });
  assert.equal(results.length, 4); assert.ok(Buffer.byteLength(JSON.stringify(results)) <= 8000);
  for (const result of results) {
    assert.equal(result.exit_code, 7); assert.equal(result.status, 'error'); assert.match(result.full_result, /^[a-f0-9]{64}$/);
    for (const [index, expected] of [[0, stdout], [1, stderr]]) {
      const whole = await readContext({ ...fixture.request, reference: result.full_result, cursor: result.full_result + ':whole:' + index });
      assert.equal(whole.entries[0].content.includes(expected), true);
    }
  }
});

// A later generated-file edit must not destroy historical failure output from the same current task.
test('mutating_checks_keep_prior_logs_and_refresh_task_snapshot', async () => {
  const fixture = await checksFixture();
  await writeFile(join(fixture.root, 'mutate.mjs'), "import {writeFileSync} from 'node:fs';writeFileSync('generated.txt','checked output\\n');\n");
  await writeFile(join(fixture.root, 'package.json'), JSON.stringify({ ...fixture.manifest,
    scripts: { ...fixture.manifest.scripts, mutate: 'node mutate.mjs' } }));
  await refreshChecksFixture(fixture);
  const before = await readContextTask(fixture.request.state_dir, fixture.root, fixture.request.session_id);
  const results = await projectChecks.runProjectChecks({ ...fixture.request, checks: ['test', 'mutate'] });
  assert.deepEqual(results.map(result => result.exit_code), [7, 0]);
  const after = await readContextTask(fixture.request.state_dir, fixture.root, fixture.request.session_id);
  assert.notEqual(after.repo_revision, before.repo_revision); assert.ok(after.inventory.includes('generated.txt'));
  const whole = await readContext({ ...fixture.request, reference: results[0].full_result,
    cursor: results[0].full_result + ':whole:1' });
  assert.equal(whole.exit_code, 7); assert.equal(whole.entries[0]?.content.includes(diagnostic), true);
  assert.equal(whole.repo_revision, before.repo_revision, 'Historical logs retain their execution revision');
  const [subsequent] = await projectChecks.runProjectChecks({ ...fixture.request, checks: ['empty'] });
  assert.equal(subsequent.exit_code, 7);
  assert.equal(await saveContextTask(fixture.request.state_dir, { ...after, context_epoch: 'changed-epoch',
    previous_state_hash: (await import('node:crypto')).createHash('sha256').update(JSON.stringify(after)).digest('hex') }), true);
  assert.equal((await readContext({ ...fixture.request, reference: results[0].full_result })).status, 'error');
});

// The ordinary edit -> check workflow must refresh evidence without requiring another user prompt.
test('explicit_checks_refresh_same_turn_edits', async () => {
  const fixture = await checksFixture();
  await writeFile(join(fixture.root, 'empty.mjs'), 'process.stderr.write("edited check\\n");process.exitCode=7;\n');
  let results;
  await assert.doesNotReject(async () => { results = await projectChecks.runProjectChecks({ ...fixture.request, checks: ['empty'] }); });
  assert.equal(results[0].exit_code, 7); assert.match(results[0].stderr, /edited check/);
  const after = await readContextTask(fixture.request.state_dir, fixture.root, fixture.request.session_id);
  assert.notEqual(after.repo_revision, fixture.state.repo_revision);
  assert.equal(after.turn_id, fixture.state.turn_id); assert.equal(after.permissions_hash, fixture.state.permissions_hash);
});

// A generated artifact beyond the snapshot ceiling must not replace an already executed failure with a generic exception.
test('post_execution_snapshot_failure_preserves_exit_and_private_diagnostic', async () => {
  const fixture = await checksFixture();
  await writeFile(join(fixture.root, 'generate.mjs'), "import {writeFileSync} from 'node:fs';writeFileSync('generated.bin',Buffer.alloc(64_000_001));process.stderr.write('original failure\\n');process.exitCode=7;\n");
  await writeFile(join(fixture.root, 'package.json'), JSON.stringify({ ...fixture.manifest,
    scripts: { ...fixture.manifest.scripts, generate: 'node generate.mjs' } }));
  await refreshChecksFixture(fixture);
  let results;
  await assert.doesNotReject(async () => { results = await projectChecks.runProjectChecks({ ...fixture.request, checks: ['generate', 'test'] }); });
  assert.equal(results[0].exit_code, 7); assert.match(results[0].stderr, /original failure/);
  assert.match(results[0].result_error, /snapshot|inventory/i);
  const whole = await readContext({ ...fixture.request, reference: results[0].full_result,
    cursor: results[0].full_result + ':whole:1' });
  assert.equal(whole.exit_code, 7); assert.equal(whole.entries[0]?.content, 'original failure\n');
  await assert.rejects(access(join(fixture.root, '.check-ran')), 'Later checks must stop after failed state refresh');
});

// Failed output persistence must retain the actual check exit and explicitly report unavailable recovery.
test('post_execution_storage_failure_preserves_check_exit', async () => {
  const fixture = await checksFixture();
  const repositories = await readdir(fixture.request.state_dir);
  const sessions = await readdir(join(fixture.request.state_dir, repositories[0]));
  const directory = join(fixture.request.state_dir, repositories[0], sessions[0]);
  await chmod(directory, 0o500);
  try {
    let results;
    await assert.doesNotReject(async () => { results = await projectChecks.runProjectChecks({ ...fixture.request, byte_limit: 2000 }); });
    assert.equal(results[0].exit_code, 7); assert.match(results[0].stderr, /intentional failure/);
    assert.equal(results[0].full_result, null); assert.equal(results[0].output_complete, false);
    assert.match(results[0].result_error, /persistence failed/);
  } finally { await chmod(directory, 0o700); }
});

// Cancellation during bookkeeping must expose every requested but unexecuted check, retaining the completed exit.
test('batch_cancellation_after_success_records_unexecuted_checks', async () => {
  const fixture = await checksFixture();
  await writeFile(join(fixture.root, 'many.mjs'), "import {writeFileSync} from 'node:fs';for(let i=0;i<1000;i++)writeFileSync('generated-'+i+'.txt','fixture\\n');\n");
  await writeFile(join(fixture.root, 'package.json'), JSON.stringify({ ...fixture.manifest,
    scripts: { ...fixture.manifest.scripts, many: 'node many.mjs' } }));
  await refreshChecksFixture(fixture);
  const repositories = await readdir(fixture.request.state_dir);
  const sessions = await readdir(join(fixture.request.state_dir, repositories[0]));
  const directory = join(fixture.request.state_dir, repositories[0], sessions[0]);
  const controller = new AbortController();
  const running = projectChecks.runProjectChecks({ ...fixture.request, checks: ['many', 'test'], signal: controller.signal });
  const deadline = Date.now() + 5000;
  while (!(await readdir(directory)).some(name => name.startsWith('result-'))) {
    assert.ok(Date.now() < deadline, 'The completed check must publish its output');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  controller.abort(new Error('Stopped between checks.'));
  const results = await running;
  assert.equal(results.length, 2); assert.equal(results[0].exit_code, 0);
  assert.equal(results[1].status, 'cancelled'); assert.equal(results[1].executed, false);
  assert.notEqual(results[1].exit_code, 0); await assert.rejects(access(join(fixture.root, '.check-ran')));
});

// Native process cancellation must stop detached package-manager descendants instead of leaving a late write.
test('project_check_cli_signals_stop_descendants', async () => {
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT']) {
    const fixture = await checksFixture();
    const child = spawn(process.execPath, [resolve('src/codex-context-policy.mjs'), 'run_project_checks'],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.resume();
    const closed = new Promise(resolveExit => child.on('close', (code, termination) => resolveExit({ code, termination })));
    child.stdin.end(JSON.stringify({ ...fixture.request, checks: ['slow'] }));
    const deadline = Date.now() + 4000;
    while (!await access(join(fixture.root, '.check-ready')).then(() => true, () => false)) {
      assert.ok(Date.now() < deadline, 'The real descendant must start');
      await new Promise(resolveWait => setTimeout(resolveWait, 10));
    }
    child.kill(signal);
    const exit = await closed;
    await new Promise(resolveWait => setTimeout(resolveWait, 2100));
    await assert.rejects(access(join(fixture.root, '.check-late')), signal + ' must stop the real descendant');
    assert.ok(Number.isInteger(exit.code) && exit.code !== 0);
    assert.equal(JSON.parse(stdout)[0].status, 'cancelled');
  }
});

// Passing binary stdout and stderr must retain exact labelled bytes and successful CLI status.
test('successful_check_binary_streams_round_trip_exactly', async () => {
  const fixture = await checksFixture();
  await writeFile(join(fixture.root, 'binary.mjs'), 'process.stdout.write(Buffer.from([255,0,13,10]));process.stderr.write(Buffer.from([254,128,10]));\n');
  await writeFile(join(fixture.root, 'package.json'), JSON.stringify({ ...fixture.manifest, scripts: { binary: 'node binary.mjs' } }));
  await refreshChecksFixture(fixture);
  const cli = spawnSync(process.execPath, [resolve('src/codex-context-policy.mjs'), 'run_project_checks'],
    { input: JSON.stringify({ ...fixture.request, checks: ['binary'] }), encoding: 'utf8', timeout: 5000 });
  assert.equal(cli.status, 0, cli.stderr); const [result] = JSON.parse(cli.stdout);
  assert.equal(result.status, 'ok'); assert.equal(result.exit_code, 0);
  for (const [index, expected] of [[0, [255, 0, 13, 10]], [1, [254, 128, 10]]]) {
    const whole = await readContext({ ...fixture.request, reference: result.full_result, cursor: result.full_result + ':whole:' + index });
    assert.equal(whole.entries[0].encoding, 'base64');
    const recovered = Buffer.from(whole.entries[0].content, 'base64');
    if (index === 0) assert.ok(recovered.subarray(-4).equals(Buffer.from(expected)), 'npm headers precede exact script stdout');
    else assert.deepEqual(recovered, Buffer.from(expected));
  }
});

// Operators must discover the existing explicit commands and distinguish admission errors without side effects.
test('context_cli_help_lists_operations_and_retains_check_admission_reason', async () => {
  const help = spawnSync(process.execPath, [resolve('src/codex-context-policy.mjs'), '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  for (const operation of ['hook', 'setup-jev', 'select_code_context', 'get_repository_changes', 'read_context', 'run_project_checks'])
    assert.ok((help.stdout + help.stderr).includes(operation), operation);
  const fixture = await checksFixture();
  const cli = spawnSync(process.execPath, [resolve('src/codex-context-policy.mjs'), 'run_project_checks'],
    { input: JSON.stringify({ ...fixture.request, checks: ['test', 'unknown'] }), encoding: 'utf8', timeout: 5000 });
  assert.notEqual(cli.status, 0); assert.match(JSON.parse(cli.stdout).stderr, /unknown check/);
  await assert.rejects(access(join(fixture.root, '.check-ran')));
});

// Escaped inherited pipes cannot keep a timed-out wrapper waiting indefinitely; captured evidence is explicitly partial.
test('project_check_timeout_settles_when_detached_descendant_holds_pipes', async () => {
  const fixture = await checksFixture();
  await writeFile(join(fixture.root, 'escape.mjs'), "import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';\n" +
    "const child=spawn(process.execPath,['-e','process.stdout.write(\"escaped writer\\\\n\");setInterval(()=>{},1000)'],{detached:true,stdio:['ignore',process.stdout,process.stderr]});writeFileSync('.check-escaped',String(child.pid));child.unref();\n");
  await writeFile(join(fixture.root, 'package.json'), JSON.stringify({ ...fixture.manifest, scripts: { escape: 'node escape.mjs' } }));
  await refreshChecksFixture(fixture);
  const started = performance.now();
  const running = projectChecks.runProjectChecks({ ...fixture.request, checks: ['escape'], timeout_ms: 500 });
  const emergency = setTimeout(async () => {
    const pid = await readFile(join(fixture.root, '.check-escaped'), 'utf8').catch(() => null);
    if (pid) try { process.kill(Number(pid), 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }, 3000);
  try {
    const [result] = await running;
    assert.ok(performance.now() - started < 1800, 'Timeout settlement must not depend on inherited pipe EOF');
    assert.equal(result.status, 'timeout'); assert.equal(result.exit_code, 0, 'Observed manager exit is preserved; timeout remains a failure');
    assert.equal(result.output_complete, false);
  } finally {
    clearTimeout(emergency);
    const pid = await readFile(join(fixture.root, '.check-escaped'), 'utf8').catch(() => null);
    if (pid) try { process.kill(Number(pid), 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
});

// OS spawn failures must expose a portable failure exit rather than a negative errno modulo256 in the CLI.
test('project_check_missing_manager_preserves_reason_and_portable_exit', async () => {
  const fixture = await checksFixture(); const bin = await mkdtemp(join(temporaryRoot, 'missing-manager-'));
  await symlink('/usr/bin/git', join(bin, 'git'));
  const cli = spawnSync(process.execPath, [resolve('src/codex-context-policy.mjs'), 'run_project_checks'],
    { input: JSON.stringify(fixture.request), env: { ...gitEnvironment, PATH: bin }, encoding: 'utf8', timeout: 5000 });
  assert.equal(cli.status, 1); const [result] = JSON.parse(cli.stdout);
  assert.equal(result.exit_code, 1); assert.equal(result.status, 'error'); assert.match(result.error, /ENOENT/);
  await assert.rejects(access(join(fixture.root, '.check-ran')));
});

// If private persistence fails, a whole diagnostic fitting the routine page must still reach the caller inline.
test('storage_failure_preserves_fitting_whole_diagnostic_inline', async () => {
  const fixture = await checksFixture(); const output = 'D'.repeat(2001);
  await writeFile(join(fixture.root, 'inline.mjs'), `process.stderr.write(${JSON.stringify(output)});process.exitCode=7;\n`);
  await writeFile(join(fixture.root, 'package.json'), JSON.stringify({ ...fixture.manifest, scripts: { inline: 'node inline.mjs' } }));
  await refreshChecksFixture(fixture);
  const repositories = await readdir(fixture.request.state_dir); const sessions = await readdir(join(fixture.request.state_dir, repositories[0]));
  const directory = join(fixture.request.state_dir, repositories[0], sessions[0]); await chmod(directory, 0o500);
  try {
    const [result] = await projectChecks.runProjectChecks({ ...fixture.request, checks: ['inline'] });
    assert.equal(result.exit_code, 7); assert.equal(result.full_result, null);
    assert.equal(result.entries.find(entry => entry.stream === 'stderr')?.content, output);
    assert.equal(result.output_complete, true); assert.ok(Buffer.byteLength(JSON.stringify([result])) <= 8000);
    assert.doesNotMatch(result.stdout + result.stderr, /whole-unit retrieval|through full_result/);
  } finally { await chmod(directory, 0o700); }
});

// A real inventory ceiling must be reported as such, without falsely blaming private task identity.
test('check_cli_preserves_known_inventory_admission_failure', async () => {
  const fixture = await checksFixture(); await writeFile(join(fixture.root, 'oversized.bin'), Buffer.alloc(64_000_001));
  const cli = spawnSync(process.execPath, [resolve('src/codex-context-policy.mjs'), 'run_project_checks'],
    { input: JSON.stringify(fixture.request), encoding: 'utf8', timeout: 5000 });
  assert.notEqual(cli.status, 0); assert.match(JSON.parse(cli.stdout).stderr, /inventory byte limit exceeded/);
  await assert.rejects(access(join(fixture.root, '.check-ran')));
});

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
  await assert.rejects(projectChecks.detectDeclaredChecks(root), /unsupported.*no-install/);
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
