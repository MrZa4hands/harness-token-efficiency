import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import filesystem from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { captureContextTask, saveContextTask, resolveContextDecision, resolveContextFacts, recordContextDecision } from '../src/context-state.mjs';
import { execFileSync } from 'node:child_process';
import childProcess from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { updateContextPolicyInstall, promoteContextPolicy } from '../scripts/manage-context-policy.mjs';
import { comparePilotRuns } from '../src/context-promotion.mjs';
import { createContextPilotRuns } from './context-pilot-runs.fixture.mjs';
import { readContextSourceVersions } from '../src/codex-context-policy.mjs';

const temporary = await realpath(await mkdtemp(join(tmpdir(), 'context-read-boundaries-')));
after(() => assert.equal(spawnSync('trash', [temporary]).status, 0));

async function createBoundaryRepository(name) {
  const root = await mkdtemp(join(temporary, name));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.attributesFile=/dev/null',
    '-c', 'core.excludesFile=/dev/null', ...args], { cwd: root, env });
  git(['-c', 'init.templateDir=', 'init', '--initial-branch=fixture']);
  git(['config', 'core.excludesFile', '/dev/null']);
  git(['config', 'core.attributesFile', '/dev/null']);
  await writeFile(join(root, 'entry.mjs'), 'export const value = 1;\n');
  git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture: read boundary']);
  return { root, git };
}

// Ambient attributes and parent-repository discovery must never normalize or hide raw changes.
test('raw_diff_ignores_scratch_parent_and_ambient_attributes', async () => {
  const { root, git } = await createBoundaryRepository('scratch-attributes-');
  const before = 'const contextBefore = 0;\n// Before change.\nexport const value = 1;\n// After change.\nconst contextAfter = 0;\n';
  await writeFile(join(root, 'entry.mjs'), before);
  git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture: diff context']);
  const attributes = join(temporary, 'scratch-attributes'); await writeFile(attributes, '* -diff\n');
  execFileSync('git', ['config', 'core.attributesFile', attributes], { cwd: root });
  execFileSync('git', ['config', 'diff.context', '0'], { cwd: root });
  assert.equal(git(['config', '--get', 'diff.context']).toString().trim(), '0');
  await writeFile(join(root, 'entry.mjs'), before.replace('value = 1', 'value = 2'));
  const state = await captureContextTask({ cwd: root, session_id: 'attributes', hook_event_name: 'UserPromptSubmit', prompt: 'Review all changes.' }, null);
  const originalTmpdir = os.tmpdir; os.tmpdir = () => root; syncBuiltinESMExports();
  const originalExecFile = childProcess.execFile; const execute = promisify(originalExecFile); const scratchDirectories = [];
  const observeScratch = (...args) => originalExecFile(...args);
  observeScratch[promisify.custom] = (file, args, options) => {
    if (file === 'git' && args.includes('--no-index')) scratchDirectories.push(options.cwd);
    return execute(file, args, options);
  };
  childProcess.execFile = observeScratch; syncBuiltinESMExports();
  let changes;
  try {
    const operations = await import('../src/repository-context.mjs?scratch-attributes-boundary');
    changes = await operations.getRepositoryChanges({ repo_root: root, request_hash: state.request_hash, repo_revision: state.repo_revision,
      context_epoch: state.context_epoch, scope: { kind: 'worktree' }, byte_limit: 8000 });
  } finally { os.tmpdir = originalTmpdir; childProcess.execFile = originalExecFile; syncBuiltinESMExports(); }
  assert.ok(scratchDirectories.some(path => path.startsWith(root + '/')), 'The actual diff must run inside the configured fixture parent');
  assert.equal(changes.status, 'ok', changes.stderr);
  assert.ok(changes.entries.some(entry => entry.content.includes('+export const value = 2;\n')),
    'Plain source evidence must retain an exact text hunk under inherited binary attributes');
  assert.ok(changes.entries.some(entry => entry.content.includes('\n const contextBefore = 0;\n')),
    'Scratch Git must not inherit a parent repository configuration that trims default hunk context');
});

// Cleanup shares cancellation and preserves utility diagnostics, including a primary failure before cleanup.
test('scratch_cleanup_preserves_cancellation_and_original_errors', async () => {
  const { root } = await createBoundaryRepository('scratch-cleanup-');
  await writeFile(join(root, 'entry.mjs'), 'export const value = 2;\n');
  const state = await captureContextTask({ cwd: root, session_id: 'cleanup', hook_event_name: 'UserPromptSubmit', prompt: 'Review all changes.' }, null);
  const originalExecFile = childProcess.execFile; const execute = promisify(originalExecFile);
  const marker = join(temporary, 'cleanup-completed'); let scenario; let controller;
  const boundaryExec = (...args) => originalExecFile(...args);
  boundaryExec[promisify.custom] = (file, args, options) => {
    if (scenario === 'primary' && file === 'git' && args.includes('--no-index'))
      return execute(process.execPath, ['-e', "process.stderr.write('Synthetic raw diff unavailable.\\n');process.exit(11)"], options);
    if (file !== 'trash') return execute(file, args, options);
    if (scenario === 'cancel') {
      controller.abort();
      return execute(process.execPath, ['-e', 'setTimeout(()=>require("node:fs").writeFileSync(' + JSON.stringify(marker) + ',"completed"),200)'], options);
    }
    return execute(process.execPath, ['-e', "process.stderr.write('Synthetic cleanup unavailable.\\n');process.exit(7)"], options);
  };
  childProcess.execFile = boundaryExec; syncBuiltinESMExports();
  try {
    const operations = await import('../src/repository-context.mjs?cleanup-boundary');
    for (scenario of ['cancel', 'cleanup', 'primary']) {
      controller = new AbortController();
      const result = await operations.getRepositoryChanges({ repo_root: root, request_hash: state.request_hash, repo_revision: state.repo_revision,
        context_epoch: state.context_epoch, scope: { kind: 'worktree' }, byte_limit: 8000, signal: controller.signal });
      if (scenario === 'cancel') {
        assert.equal(await filesystem.access(marker).then(() => true, () => false), false,
          'Cancelled scratch cleanup must not complete a child process after the preparation deadline');
        assert.equal(result.status, 'error');
      } else {
        assert.equal(result.exit_code, scenario === 'primary' ? 11 : 7, 'Cleanup cannot replace the original utility exit code');
        assert.match(result.stderr, scenario === 'primary' ? /Synthetic raw diff unavailable/ : /Synthetic cleanup unavailable/);
      }
    }
  } finally { childProcess.execFile = originalExecFile; syncBuiltinESMExports(); }
});

// Diagnostic bytes must not replace the failing Git process's original exit code.
test('repository_git_failure_preserves_non_utf8_diagnostics', async () => {
  const { root } = await createBoundaryRepository('binary-diagnostics-');
  await writeFile(join(root, 'entry.mjs'), 'export const value = 2;\n');
  const state = await captureContextTask({ cwd: root, session_id: 'binary-diagnostics', turn_id: 'binary-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Review all changes.', permission_mode: 'read-only' }, null);
  const bytes = Buffer.from('64696167ff0a', 'hex');
  const original = childProcess.execFile; const execute = promisify(original);
  const boundary = (...args) => original(...args);
  boundary[promisify.custom] = (file, args, options) => file === 'git' && args.includes('--no-index')
    ? execute(process.execPath, ['-e', 'process.stderr.write(Buffer.from("64696167ff0a","hex"));process.exit(7)'], options)
    : execute(file, args, options);
  childProcess.execFile = boundary; syncBuiltinESMExports();
  try {
    const operations = await import('../src/repository-context.mjs?binary-diagnostic-boundary');
    const result = await operations.getRepositoryChanges({ repo_root: root, request_hash: state.request_hash,
      repo_revision: state.repo_revision, context_epoch: state.context_epoch, scope: { kind: 'worktree' }, byte_limit: 8000 });
    assert.equal(result.status, 'error'); assert.equal(result.exit_code, 7, 'Invalid UTF-8 diagnostics must preserve the original failure');
    assert.match(result.stderr, /^Repository context stderr \(base64\): /);
    assert.deepEqual(Buffer.from(result.stderr.split(': ')[1], 'base64'), bytes);
  } finally { childProcess.execFile = original; syncBuiltinESMExports(); }
});

// Native private footprint without Git ignore rules must not leak through automatic evidence selection.
test('owned_runtime_is_private_but_explicit_and_foreign_evidence_remains_available', async () => {
  const { root, git } = await createBoundaryRepository('runtime-evidence-');
  await mkdir(join(root, '.codex'));
  await writeFile(join(root, '.codex/codex-context-policy-coverage.json'), JSON.stringify({ client_version: '0.159.2', events: { UserPromptSubmit: 'supported' } }), { mode: 0o600 });
  assert.equal((await updateContextPolicyInstall({ repo_root: root, source_root: resolve('.'), action: 'install', apply: true })).error, null);
  await writeFile(join(root, '.codex/foreign.json'), JSON.stringify({ source_root: 'Synthetic foreign evidence' }));
  const state = await captureContextTask({ cwd: root, session_id: 'runtime', hook_event_name: 'UserPromptSubmit', prompt: 'Inspect source_root.' }, null);
  const operations = await import('../src/repository-context.mjs');
  const request = { repo_root: root, request_hash: state.request_hash, repo_revision: state.repo_revision, context_epoch: state.context_epoch,
    scope: { kind: 'worktree' }, byte_limit: 8000 };
  const changes = await operations.getRepositoryChanges(request);
  assert.ok(changes.status === 'error' || changes.entries.every(entry => !entry.path.startsWith('.codex/codex-context-') && entry.path !== '.codex/hooks.json'),
    'Private installed runtime must be excluded or cause baseline, never automatic code evidence');
  const selected = await operations.selectCodeContext({ ...request, paths: [], symbols: ['source_root'], family: 'code_context', exhaustive: false });
  assert.equal(selected.status, 'ok', selected.stderr);
  assert.ok(selected.entries.some(entry => entry.path === '.codex/foreign.json'));
  assert.ok(!selected.entries.some(entry => entry.path === '.codex/codex-context-policy-install.json'));
  const explicit = await operations.selectCodeContext({ ...request, paths: ['.codex/codex-context-policy-install.json'],
    symbols: [], family: 'code_context', exhaustive: false });
  assert.equal(explicit.status, 'ok', explicit.stderr);
  assert.ok(explicit.entries.some(entry => entry.path === '.codex/codex-context-policy-install.json'));
  const config = JSON.parse(await filesystem.readFile(join(root, '.codex/codex-context-policy.json'), 'utf8'));
  const questions = JSON.parse(await filesystem.readFile(resolve('config/jev-questions.json'), 'utf8'));
  const versions = await readContextSourceVersions(resolve('.'), { config, questions,
    input: { client_version: '0.159.2', model: 'fixture-main-model', reasoning_effort: 'medium' } });
  const runs = createContextPilotRuns(versions); runs[0].private_runtime_note = 'SYNTHETIC_PRIVATE_RUNTIME_NOTE';
  const reportPath = join(temporary, 'runtime-qualified-report.json');
  for (const family of ['code_context', 'code_review_context', 'documentation_context', 'get_repository_changes',
    'read_context', 'run_project_checks', 'rewrite_simple_command']) {
    await writeFile(reportPath, JSON.stringify(comparePilotRuns(runs.map(row => ({ ...row, family })))), { mode: 0o600 });
    assert.equal((await promoteContextPolicy({ repo_root: root, report_path: reportPath, family,
      variant: 'deterministic', apply: true })).error, null);
    const privateState = await captureContextTask({ cwd: root, session_id: 'private-' + family,
      hook_event_name: 'UserPromptSubmit', prompt: 'Inspect SYNTHETIC_PRIVATE_RUNTIME_NOTE.' }, null);
    const selected = await operations.selectCodeContext({ ...request, request_hash: privateState.request_hash,
      repo_revision: privateState.repo_revision, context_epoch: privateState.context_epoch,
      byte_limit: 2_000_000, paths: [], symbols: ['SYNTHETIC_PRIVATE_RUNTIME_NOTE'], family: 'code_context', exhaustive: false });
    assert.equal(selected.status, 'ok', selected.stderr);
    assert.ok(!selected.entries.some(entry => entry.path.startsWith('.codex/codex-context-promotion-')),
      family + ' private reports cannot become automatic evidence');
    const privateChanges = await operations.getRepositoryChanges({ ...request, request_hash: privateState.request_hash,
      repo_revision: privateState.repo_revision, context_epoch: privateState.context_epoch });
    assert.ok(privateChanges.status === 'error' || !privateChanges.entries.some(entry => entry.path.startsWith('.codex/codex-context-promotion-')),
      family + ' private reports cannot become automatic change evidence');
  }
  await writeFile(reportPath, JSON.stringify(comparePilotRuns(runs)), { mode: 0o600 });
  assert.equal((await promoteContextPolicy({ repo_root: root, report_path: reportPath, family: 'code_context',
    variant: 'deterministic', apply: true })).error, null);
  const reportState = await captureContextTask({ cwd: root, session_id: 'runtime-report', hook_event_name: 'UserPromptSubmit',
    prompt: 'Inspect SYNTHETIC_PRIVATE_RUNTIME_NOTE.' }, null);
  const reportRequest = { ...request, request_hash: reportState.request_hash, repo_revision: reportState.repo_revision,
    context_epoch: reportState.context_epoch, byte_limit: 2_000_000, family: 'code_context', exhaustive: false };
  const reportName = '.codex/codex-context-promotion-code_context-deterministic.json';
  const automatic = await operations.selectCodeContext({ ...reportRequest, paths: [], symbols: ['SYNTHETIC_PRIVATE_RUNTIME_NOTE'] });
  assert.equal(automatic.status, 'ok', automatic.stderr);
  assert.ok(!automatic.entries.some(entry => entry.path === reportName), 'Manager-owned private promotion reports cannot become automatic evidence');
  const reportExplicit = await operations.selectCodeContext({ ...reportRequest, paths: [reportName], symbols: [] });
  assert.equal(reportExplicit.status, 'ok', reportExplicit.stderr);
  assert.ok(reportExplicit.entries.some(entry => entry.path === reportName));
  git(['add', reportName]);
  const trackedState = await captureContextTask({ cwd: root, session_id: 'tracked-report', hook_event_name: 'UserPromptSubmit',
    prompt: 'Inspect SYNTHETIC_PRIVATE_RUNTIME_NOTE.' }, null);
  const tracked = await operations.selectCodeContext({ ...reportRequest, paths: [], symbols: ['SYNTHETIC_PRIVATE_RUNTIME_NOTE'],
    request_hash: trackedState.request_hash, repo_revision: trackedState.repo_revision, context_epoch: trackedState.context_epoch });
  assert.equal(tracked.status, 'ok', tracked.stderr); assert.ok(tracked.entries.some(entry => entry.path === reportName));
});

// Literal unresolved references in documentation retain partial coverage without reading outside the root.
test('documentation_keeps_unresolved_external_imports_partial', async () => {
  const { root } = await createBoundaryRepository('external-reference-');
  const body = "Example:\n```js\nimport value from '../../external.mjs';\n```\n";
  await writeFile(join(root, 'README.md'), body);
  const state = await captureContextTask({ cwd: root, session_id: 'external-reference', hook_event_name: 'UserPromptSubmit', prompt: 'Explain README.md.' }, null);
  const { selectCodeContext } = await import('../src/repository-context.mjs');
  const result = await selectCodeContext({ repo_root: root, request_hash: state.request_hash, repo_revision: state.repo_revision,
    context_epoch: state.context_epoch, scope: { kind: 'worktree' }, paths: ['README.md'], symbols: [], family: 'documentation_context',
    exhaustive: false, byte_limit: 8000 });
  assert.equal(result.status, 'ok', result.stderr); assert.equal(result.coverage_status, 'partial');
  assert.equal(result.entries.find(entry => entry.path === 'README.md').content, body);
  const denied = await selectCodeContext({ repo_root: root, request_hash: state.request_hash, repo_revision: state.repo_revision,
    context_epoch: state.context_epoch, scope: { kind: 'worktree' }, paths: ['../../external.mjs'], symbols: [], family: 'documentation_context', exhaustive: false });
  assert.equal(denied.status, 'error');
});

// A FIFO or a regular-file-to-FIFO race must return baseline instead of blocking automatic preparation.
test('context_private_reads_reject_fifos_without_waiting_for_a_writer', async context => {
  for (const scenario of ['receipt', 'policy', 'task', 'inventory-race']) await context.test(scenario, async () => {
    const root = await mkdtemp(join(temporary, scenario + '-'));
    assert.equal(spawnSync('git', ['-c', 'init.templateDir=', 'init', '--initial-branch=fixture'], { cwd: root }).status, 0);
    await mkdir(join(root, '.codex'), { mode: 0o700 });
    const stateDir = join(root, 'private-state');
    const taskDir = join(stateDir, createHash('sha256').update(root).digest('hex'), createHash('sha256').update('fifo-session').digest('hex'));
    await mkdir(taskDir, { recursive: true, mode: 0o700 });
    const paths = { receipt: join(root, '.codex/codex-context-policy-install.json'),
      policy: join(root, '.codex/codex-context-policy.json'), task: join(taskDir, 'task.json'),
      'inventory-race': join(root, 'example.mjs') };
    if (scenario !== 'policy') await writeFile(paths.policy, JSON.stringify({ mode: 'shadow', jev_enabled: false }), { mode: 0o600 });
    if (scenario === 'inventory-race') await writeFile(paths[scenario], 'export const example = true;\n', { mode: 0o600 });
    else assert.equal(spawnSync('mkfifo', ['-m', '600', paths[scenario]]).status, 0);
    const program = `
      import filesystem from 'node:fs/promises';
      import { spawnSync } from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      import { pathToFileURL } from 'node:url';
      const [scenario,root,source,stateDir,target]=process.argv.slice(1);
      const input={cwd:root,session_id:'fifo-session',turn_id:'fifo-turn',hook_event_name:'UserPromptSubmit',prompt:'Inspect example.mjs.'};
      if(scenario==='inventory-race') {
        const original=filesystem.open; let replaced=false;
        filesystem.open=async(path,...args)=>{
          if(path===target&&!replaced){replaced=true;await filesystem.rename(target,target+'.regular');
            if(spawnSync('mkfifo',['-m','600',target]).status!==0)throw new Error('Fixture FIFO creation failed');}
          return original(path,...args);
        };syncBuiltinESMExports();
      }
      try {
        if(scenario==='task') await (await import(pathToFileURL(source+'/src/context-state.mjs'))).readContextTask(stateDir,root,input.session_id);
        else if(scenario==='inventory-race') await (await import(pathToFileURL(source+'/src/context-state.mjs'))).captureContextTask(input,null);
        else await (await import(pathToFileURL(source+'/src/codex-context-policy.mjs'))).handleCodexHook(input,scenario==='receipt'?source:undefined);
        console.log('baseline');
      } catch(error) { if(!error.message.startsWith('Context '))throw error;console.log('baseline'); }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program, scenario, root, resolve('.'), stateDir, paths[scenario]],
      { encoding: 'utf8', timeout: 2500, env: { ...process.env, HOME: root, TYPESAFE_API_KEY: '' } });
    assert.equal(result.status, 0, scenario + ' must return rather than hang until killed: ' + (result.error?.code ?? result.stderr));
    assert.equal(result.stdout.trim(), 'baseline');
  });
});

// Maintenance must not borrow a fresh sibling writer's lock or invalidate its task history.
test('retention_does_not_lock_a_fresh_sibling_session', async () => {
  const root = await mkdtemp(join(temporary, 'sibling-'));
  assert.equal(spawnSync('git', ['-c', 'init.templateDir=', 'init', '--initial-branch=fixture'], { cwd: root }).status, 0);
  await writeFile(join(root, 'example.mjs'), 'export const example = true;\n');
  const input = { cwd: root, session_id: 'active-sibling', hook_event_name: 'UserPromptSubmit', prompt: 'Inspect example.mjs.' };
  const stateDir = join(temporary, 'sibling-state');
  const initial = await captureContextTask(input, null); await saveContextTask(stateDir, initial);
  const next = await captureContextTask({ ...input, prompt: 'hazlo' }, initial);
  const observing = await captureContextTask({ ...input, session_id: 'observing' }, null);
  const path = join(stateDir, createHash('sha256').update(root).digest('hex'), createHash('sha256').update(input.session_id).digest('hex'), 'task.json');
  const realOpen = filesystem.open; let interleaved = false; let saved;
  const interception = mock.method(filesystem, 'open', async (target, ...args) => {
    const file = await realOpen(target, ...args);
    if (target === path && !interleaved) { interleaved = true; saved = await saveContextTask(stateDir, next); }
    return file;
  });
  syncBuiltinESMExports();
  try { await recordContextDecision(stateDir, observing, resolveContextDecision(observing, resolveContextFacts(observing), null)); }
  finally { interception.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(interleaved, true); assert.equal(saved, true, 'Optional pruning cannot force an unrelated active writer to lose its state');
});

// The deadline must still be enforced after file verification, during exact protected-path selection.
test('context_capture_deadline_covers_final_path_selection', async () => {
  const root = await mkdtemp(join(temporary, 'path-deadline-'));
  assert.equal(spawnSync('git', ['-c', 'init.templateDir=', 'init', '--initial-branch=fixture'], { cwd: root }).status, 0);
  const target = join(root, 'example.mjs'); await writeFile(target, 'export const example = true;\n');
  const realLstat = filesystem.lstat; const realNow = Date.now;
  let reads = 0; let expired = false;
  const clock = mock.method(Date, 'now', () => realNow() + (expired ? 2000 : 0));
  const checking = mock.method(filesystem, 'lstat', async path => {
    const stat = await realLstat(path);
    if (path === target && ++reads === 3) expired = true;
    return stat;
  });
  syncBuiltinESMExports();
  try { await assert.rejects(captureContextTask({ cwd: root, session_id: 'deadline', hook_event_name: 'UserPromptSubmit', prompt: 'Inspect example.mjs.' }, null), /Context inventory deadline/); }
  finally { checking.mock.restore(); clock.mock.restore(); syncBuiltinESMExports(); }
});
