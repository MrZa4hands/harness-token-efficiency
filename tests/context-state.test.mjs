import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, symlink, realpath, rename, utimes, copyFile, appendFile, chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { captureContextTask, readContextTask, saveContextTask, resolveContextFacts,
  resolveContextDecision, recordContextDecision } from '../src/context-state.mjs';
import { minimizeJevState } from '../src/jev-client.mjs';
import contextFileSystem from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { updateContextPolicyInstall } from '../scripts/manage-context-policy.mjs';

const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'context-state-tests-')));
after(() => assert.equal(spawnSync('trash', [temporaryRoot]).status, 0));
const gitEnvironment = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
async function createStateRepository() {
  const root = await mkdtemp(join(temporaryRoot, 'repository-'));
  assert.equal(spawnSync('git', ['-c', 'init.templateDir=', 'init', '--initial-branch=fixture-main'],
    { cwd: root, env: gitEnvironment }).status, 0);
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src/example.mjs'), 'export const value = 1;\n');
  return root;
}
function hookInput(root, session = 'session-one', extra = {}) {
  return { cwd: root, session_id: session, turn_id: 'turn-one', hook_event_name: 'UserPromptSubmit',
    prompt: 'Review all changes and inspect `src/example.mjs`.', model: 'fixture-model', permission_mode: 'read-only', ...extra };
}

// Dropping repository/session isolation, working content hashes, or protected continuity must fail here.
test('state_isolation_and_continuity', async () => {
  const root = await createStateRepository();
  const otherRoot = await createStateRepository();
  const stateDir = join(temporaryRoot, 'private-state');
  const initial = await captureContextTask(hookInput(root), null);
  assert.equal(initial.session_id, 'session-one', 'Captured state must retain the validated native identity');
  assert.equal(initial.turn_id, 'turn-one');
  assert.equal(initial.continuity, 'new');
  assert.equal(initial.protected_requirements.includes('exhaustive_coverage'), true);
  assert.equal(initial.protected_requirements.includes('path:src/example.mjs'), true);
  assert.equal(await saveContextTask(stateDir, initial), true);
  const others = await Promise.all([captureContextTask(hookInput(otherRoot), null),
    captureContextTask(hookInput(root, 'session-two'), null)]);
  assert.deepEqual(await Promise.all(others.map(state => saveContextTask(stateDir, state))), [true, true]);
  assert.equal((await readContextTask(stateDir, root, 'session-one')).request_hash, initial.request_hash);
  assert.equal((await readContextTask(stateDir, otherRoot, 'session-one')).repo_root, otherRoot);
  assert.equal((await readContextTask(stateDir, root, 'session-two')).session_id, 'session-two');

  await writeFile(join(root, 'src/example.mjs'), 'export const value = 2;\n');
  const followup = await captureContextTask(hookInput(root, 'session-one', { turn_id: 'turn-two', prompt: 'hazlo' }), initial);
  assert.notEqual(followup.repo_revision, initial.repo_revision);
  assert.deepEqual(followup.protected_requirements, initial.protected_requirements);
  assert.equal(followup.continuity, 'known');
  assert.equal(followup.recent_requests[0].text, 'Review all changes and inspect `src/example.mjs`.');
  const knownDecision = resolveContextDecision(followup, resolveContextFacts(followup), null);
  assert.equal(knownDecision.operation, 'code_review_context');
  assert.equal(knownDecision.action, 'prefetch');
  assert.equal(knownDecision.applied, false);
  assert.equal(await saveContextTask(stateDir, followup), true);
  await writeFile(join(root, 'new-file.txt'), 'new candidate\n');
  const added = await captureContextTask(hookInput(root, 'session-one', { turn_id: 'turn-three', prompt: 'continue' }), followup);
  assert.notEqual(added.repo_revision, followup.repo_revision);
  assert.notEqual(added.inventory_hash, followup.inventory_hash);

  const competing = await captureContextTask(hookInput(root, 'session-one', { turn_id: 'turn-four',
    prompt: 'Inspect `new-file.txt`.' }), followup);
  const saved = await Promise.all([saveContextTask(stateDir, added), saveContextTask(stateDir, competing)]);
  assert.equal(saved.filter(Boolean).length, 1, 'An overlapping writer must abstain rather than overwrite constraints');
  assert.equal(await saveContextTask(stateDir, followup), false, 'A stale parent revision cannot be written back');
  const unknown = await captureContextTask(hookInput(root, 'new-session', { prompt: 'hazlo' }), null);
  assert.equal(resolveContextDecision(unknown, resolveContextFacts(unknown), null).action, 'baseline');
  const changedPermissions = await captureContextTask(hookInput(root, 'session-one', {
    permission_mode: 'full-access', corpus_hash: 'new-corpus' }), initial);
  assert.notEqual(changedPermissions.permissions_hash, initial.permissions_hash);
  assert.notEqual(changedPermissions.corpus_hash, initial.corpus_hash);
  await assert.rejects(captureContextTask(hookInput(root, 'session-one', { parent_session_id: 'session-one' }), initial),
    /Context task identity/);
});

// Following an external link or accepting corrupt private state can mix unauthorized evidence into a task.
test('state_rejects_external_evidence_and_corrupt_storage', async () => {
  const root = await createStateRepository();
  const outside = join(temporaryRoot, 'outside-private.txt');
  await writeFile(outside, 'SYNTHETIC_OUTSIDE_SECRET');
  await symlink(outside, join(root, 'external.txt'));
  const state = await captureContextTask(hookInput(root), null);
  assert.equal(state.inventory.includes('external.txt'), true);
  assert.equal(state.unreadable_paths.includes('external.txt'), true);
  const stateDir = join(temporaryRoot, 'privacy-state');
  assert.equal(await saveContextTask(stateDir, state), true);
  const repositories = await readdir(stateDir);
  const sessions = await readdir(join(stateDir, repositories[0]));
  const sessionPath = join(stateDir, repositories[0], sessions[0]);
  assert.equal((await lstat(sessionPath)).mode & 0o777, 0o700);
  assert.equal((await lstat(join(sessionPath, 'task.json'))).mode & 0o777, 0o600);
  const decision = resolveContextDecision(state, resolveContextFacts(state), null);
  assert.equal(await recordContextDecision(stateDir, state, decision), true);
  assert.equal(await recordContextDecision(stateDir, state, decision), false, 'Decision records are immutable');
  const decisions = (await readdir(sessionPath)).filter(path => path.startsWith('decision-'));
  const text = await readFile(join(sessionPath, decisions[0]), 'utf8');
  assert.equal(text.includes('Review all changes'), false);
  assert.equal(text.includes('SYNTHETIC_OUTSIDE_SECRET'), false);
  assert.equal(text.includes('src/example.mjs'), false, 'Telemetry stores candidate hashes, not paths or code');
  assert.equal(JSON.parse(text).applied, false);
  await writeFile(join(sessionPath, 'task.json'), '{BROKEN_PRIVATE_STATE');
  await assert.rejects(readContextTask(stateDir, root, 'session-one'), /Context task state rejected/);
  await assert.rejects(saveContextTask(stateDir, state), /Context task state rejected/);
});

// Rotating recent requests must not drop the active objective during a long explicit continuation.
test('context_continuation_retains_goal_after_request_rotation', async () => {
  const root = await createStateRepository();
  let state = await captureContextTask(hookInput(root), null);
  for (let turn = 0; turn < 7; turn++) state = await captureContextTask(hookInput(root, 'session-one', {
    turn_id: 'continued-' + turn, prompt: 'hazlo' }), state);
  assert.equal(resolveContextDecision(state, resolveContextFacts(state), null).operation, 'code_review_context');
  assert.equal(state.recent_requests.length <= 6, true);
});

// A real shadow invocation must persist decisions; off and unsupported events must never do so.
test('shadow_hook_records_isolated_decisions_without_injection', async () => {
  const root = await createStateRepository();
  const home = await mkdtemp(join(temporaryRoot, 'native-home-'));
  await mkdir(join(root, '.codex'));
  const configPath = join(root, '.codex/codex-context-policy.json');
  await writeFile(configPath, JSON.stringify({ mode: 'shadow', jev_enabled: false }), { mode: 0o600 });
  await writeFile(join(root, '.codex/codex-context-policy-coverage.json'), JSON.stringify({
    client_version: '0.159.2', events: { UserPromptSubmit: 'supported' } }));
  assert.equal((await updateContextPolicyInstall({ repo_root: root, source_root: resolve('.'), action: 'install', apply: true })).error, null);
  const invoke = input => spawnSync(process.execPath, [resolve('src/codex-context-policy.mjs'), 'hook'], {
    env: { ...gitEnvironment, HOME: home, TYPESAFE_API_KEY: '' }, input: JSON.stringify(input), encoding: 'utf8', timeout: 3000 });
  const first = invoke(hookInput(root, 'native-one'));
  assert.equal(first.status, 0); assert.equal(first.stdout, ''); assert.equal(first.stderr, '');
  const runtimeRoot = join(home, '.codex/codex-context-policy');
  const repositories = await readdir(runtimeRoot).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  assert.equal(repositories.length, 1, 'Shadow must persist an isolated repository observation');
  const repositoryPath = join(runtimeRoot, repositories[0]);
  assert.equal(invoke(hookInput(root, 'native-two')).stderr, '');
  assert.equal((await readdir(repositoryPath)).length, 2);
  const interrupted = invoke(hookInput(root, 'native-one', { turn_id: 'failed-turn', prompt: 'x'.repeat(6001) }));
  assert.match(interrupted.stderr, /Context request byte limit exceeded/);
  assert.equal(invoke(hookInput(root, 'native-one', { turn_id: 'gap-followup', prompt: 'hazlo' })).stdout, '');
  const firstSessionPath = join(repositoryPath, createHash('sha256').update('native-one').digest('hex'));
  const followupHash = createHash('sha256').update('gap-followup').digest('hex');
  const records = await Promise.all((await readdir(firstSessionPath)).filter(name => name.startsWith('decision-'))
    .map(async name => JSON.parse(await readFile(join(firstSessionPath, name), 'utf8'))));
  assert.equal(records.find(record => record.turn_hash === followupHash).action, 'baseline',
    'A failed intervening request must not authorize continuation of the old objective');
  const gappedState = await readContextTask(runtimeRoot, root, 'native-one');
  assert.equal(minimizeJevState(gappedState, resolveContextFacts(gappedState)), null,
    'Missing request context must not be reconstructed by Jev');
  assert.equal(invoke(hookInput(root, 'native-one', { turn_id: 'explicit-recovery', prompt: 'Inspect src/example.mjs.' })).stderr, '');
  assert.equal((await readContextTask(runtimeRoot, root, 'native-one')).active_request.text, 'Inspect src/example.mjs.');
  await writeFile(configPath, JSON.stringify({ mode: 'off', jev_enabled: false }));
  assert.equal(invoke(hookInput(root, 'native-off')).stderr, '');
  assert.equal((await readdir(repositoryPath)).length, 2, 'Off is checked again on every invocation');
  await writeFile(configPath, JSON.stringify({ mode: 'enforce', jev_enabled: false }));
  assert.equal(invoke(hookInput(root, 'unsupported', { hook_event_name: 'PreToolUse' })).stdout, '');
  assert.equal((await readdir(repositoryPath)).length, 2);
  const enforced = invoke(hookInput(root, 'native-enforce'));
  assert.equal(enforced.stdout, '', 'Phase 1 must not inject even when enforce is requested');
  assert.equal(enforced.stderr, '');

  const alternate = await mkdtemp(join(temporaryRoot, 'alternate-source-'));
  await mkdir(join(alternate, 'src')); await mkdir(join(alternate, 'config'));
  await Promise.all(['src/codex-context-policy.mjs', 'src/context-state.mjs', 'src/jev-client.mjs', 'src/context-credentials.mjs',
    'src/repository-context.mjs', 'src/context-results.mjs', 'src/context-prefetch.mjs', 'src/context-promotion.mjs',
    'config/jev-questions.json', 'config/hooks.template.json', 'config/context-policy.template.json']
    .map(path => copyFile(resolve(path), join(alternate, path))));
  await appendFile(join(alternate, 'src/context-state.mjs'), '\n// Fixture policy implementation fingerprint change.\n');
  const invokeAlternate = () => spawnSync(process.execPath, [join(alternate, 'src/codex-context-policy.mjs'), 'hook'], {
    env: { ...gitEnvironment, HOME: home, TYPESAFE_API_KEY: '' }, input: JSON.stringify(hookInput(root, 'native-one')),
    encoding: 'utf8', timeout: 3000 });
  assert.equal(invoke(hookInput(root, 'native-one')).stderr, '');
  const beforeAlternate = (await readdir(firstSessionPath)).filter(name => name.startsWith('decision-')).length;
  assert.equal(invokeAlternate().stderr, '');
  assert.equal((await readdir(firstSessionPath)).filter(name => name.startsWith('decision-')).length, beforeAlternate,
    'A second source must remain inert for a target owned by the installed source');
  const oldPolicyHash = (await readContextTask(runtimeRoot, root, 'native-one')).versions.policy_hash;
  assert.equal((await updateContextPolicyInstall({ repo_root: root, source_root: resolve('.'), action: 'remove', apply: true })).error, null);
  assert.equal((await updateContextPolicyInstall({ repo_root: root, source_root: alternate, action: 'install', apply: true })).error, null);
  assert.equal(invokeAlternate().stderr, '');
  assert.notEqual((await readContextTask(runtimeRoot, root, 'native-one')).versions.policy_hash, oldPolicyHash,
    'Changing the owning implementation must change decision provenance without changing configuration');
});

// Expired continuity must abstain, and a linked private ancestor must never receive state writes.
test('private_state_expiration_and_ancestor_boundaries', async () => {
  const root = await createStateRepository();
  const stateDir = join(temporaryRoot, 'retention-state');
  const state = await captureContextTask(hookInput(root), null);
  state.updated_at = new Date(Date.now() - 8 * 86400000).toISOString();
  assert.equal(await saveContextTask(stateDir, state), true);
  assert.equal(await readContextTask(stateDir, root, 'session-one'), null, 'Expired state cannot imply known continuity');
  const ancestor = join(temporaryRoot, 'state-ancestor');
  const outside = join(temporaryRoot, 'state-moved-outside');
  await mkdir(ancestor, { mode: 0o700 });
  await mkdir(join(ancestor, 'parent'), { mode: 0o700 });
  await rename(ancestor, outside);
  await symlink(outside, ancestor);
  await assert.rejects(saveContextTask(join(ancestor, 'parent', 'state'), state), /Context state directory rejected/);
  assert.deepEqual(await readdir(join(outside, 'parent')), []);
});

// Unknown continuity must keep the previous explicit goal available to a bounded semantic observation.
test('unknown_context_retains_prior_goal_for_semantic_observation', async () => {
  const root = await createStateRepository();
  const prior = await captureContextTask(hookInput(root), null);
  const next = await captureContextTask(hookInput(root, 'session-one', {
    turn_id: 'different-turn', prompt: 'Where is that used?' }), prior);
  const facts = resolveContextFacts(next);
  assert.equal(next.continuity, 'unknown');
  assert.equal(resolveContextDecision(next, facts, null).action, 'baseline');
  assert.equal(minimizeJevState(next, facts).active_goal, 'Review all changes and inspect `src/example.mjs`.');
  assert.equal(minimizeJevState(next, facts).request, 'Where is that used?');
  const uncertainFollowup = await captureContextTask(hookInput(root, 'session-one', {
    turn_id: 'uncertain-followup', prompt: 'hazlo' }), next);
  assert.equal(resolveContextDecision(uncertainFollowup, resolveContextFacts(uncertainFollowup), null).action, 'baseline',
    'An unresolved intervening request cannot manufacture known continuity');
});

// Already-dirty file edits and same-tree HEAD changes during capture must never certify mixed evidence.
test('context_capture_rejects_changes_after_an_earlier_file_was_hashed', async () => {
  const realOpen = contextFileSystem.open;
  for (const mutation of ['dirty-file', 'head']) {
    const root = await createStateRepository();
    const git = args => assert.equal(spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture',
      '-c', 'user.email=fixture@example.invalid', ...args], { cwd: root, env: gitEnvironment }).status, 0);
    git(['add', '.']); git(['commit', '-m', 'Fixture baseline']);
    await writeFile(join(root, 'src/example.mjs'), 'export const value = 2;\n');
    const laterPath = join(root, 'src/z-later.mjs');
    await writeFile(laterPath, 'export const later = true;\n');
    const interception = mock.method(contextFileSystem, 'open', async (path, ...args) => {
      const file = await realOpen(path, ...args);
      if (path === laterPath) {
        if (mutation === 'dirty-file') await writeFile(join(root, 'src/example.mjs'), 'export const value = 3;\n');
        else git(['commit', '--allow-empty', '-m', 'Same-tree HEAD change']);
      }
      return file;
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(captureContextTask(hookInput(root), null), /Context inventory changed/,
        'A concurrent ' + mutation + ' mutation must invalidate the complete snapshot');
    } finally { interception.mock.restore(); syncBuiltinESMExports(); }
  }
});

// Expiry must not discard billing after a deadline or fail when another cleanup removes an old record.
test('decision_expiry_respects_deadline_and_concurrent_removal', async () => {
  const root = await createStateRepository();
  const stateDir = join(temporaryRoot, 'bounded-expiry');
  const state = await captureContextTask(hookInput(root), null);
  const oldDecision = resolveContextDecision(state, resolveContextFacts(state), null);
  await recordContextDecision(stateDir, state, oldDecision);
  const repository = (await readdir(stateDir))[0];
  const session = (await readdir(join(stateDir, repository)))[0];
  const sessionPath = join(stateDir, repository, session);
  const oldPath = join(sessionPath, 'decision-' + oldDecision.decision_id + '.json');
  const oldRecord = JSON.parse(await readFile(oldPath, 'utf8'));
  oldRecord.updated_at = new Date(Date.now() - 8 * 86400000).toISOString();
  await writeFile(oldPath, JSON.stringify(oldRecord), { mode: 0o600 });
  assert.equal(await recordContextDecision(stateDir, state,
    resolveContextDecision(state, resolveContextFacts(state), null), AbortSignal.abort()), true);
  assert.equal((await readdir(sessionPath)).includes('decision-' + oldDecision.decision_id + '.json'), true,
    'Expired preparation must preserve its new record and skip nonessential expiry');
  const realOpen = contextFileSystem.open;
  const interception = mock.method(contextFileSystem, 'open', async (path, ...args) => {
    if (path === oldPath) await rename(path, path + '.moved');
    return realOpen(path, ...args);
  });
  syncBuiltinESMExports();
  try {
    assert.equal(await recordContextDecision(stateDir, state,
      resolveContextDecision(state, resolveContextFacts(state), null)), true);
  } finally { interception.mock.restore(); syncBuiltinESMExports(); }
});

// Optional expiry must never delay billing or fail a valid decision because another record is unusable.
test('decision_cleanup_is_bounded_and_tolerates_unusable_entries', async context => {
  const root = await createStateRepository();
  const state = await captureContextTask(hookInput(root), null);
  for (const scenario of ['slow-read', 'unlink-race', 'nonprivate', 'oversized']) {
    await context.test(scenario, async () => {
    const stateDir = join(temporaryRoot, 'cleanup-' + scenario);
    const oldDecision = resolveContextDecision(state, resolveContextFacts(state), null);
    await recordContextDecision(stateDir, state, oldDecision);
    const sessionPath = join(stateDir, createHash('sha256').update(root).digest('hex'), createHash('sha256').update(state.session_id).digest('hex'));
    const oldPath = join(sessionPath, 'decision-' + oldDecision.decision_id + '.json');
    const expired = JSON.parse(await readFile(oldPath, 'utf8'));
    expired.updated_at = new Date(Date.now() - 8 * 86400000).toISOString();
    await writeFile(oldPath, JSON.stringify(expired));
    if (scenario === 'nonprivate') await chmod(oldPath, 0o644);
    if (scenario === 'oversized') await writeFile(oldPath, 'x'.repeat(1_000_001));
    const realOpen = contextFileSystem.open; const realUnlink = contextFileSystem.unlink;
    const opening = mock.method(contextFileSystem, 'open', async (path, ...args) => {
      const file = await realOpen(path, ...args);
      if (path === oldPath && scenario === 'slow-read') {
        const realRead = file.readFile.bind(file);
        file.readFile = async (...options) => { await new Promise(resolve => setTimeout(resolve, 150)); return realRead(...options); };
      }
      return file;
    });
    const removing = mock.method(contextFileSystem, 'unlink', async path => {
      if (path === oldPath && scenario === 'unlink-race') await realUnlink(path);
      return realUnlink(path);
    });
    syncBuiltinESMExports();
    const current = resolveContextDecision(state, resolveContextFacts(state), null); const started = performance.now();
    try {
      assert.equal(await recordContextDecision(stateDir, state, current, AbortSignal.timeout(10)), true);
      if (scenario === 'slow-read') assert.ok(performance.now() - started < 100, 'Nonessential reads cannot hold the shared deadline');
    } finally { opening.mock.restore(); removing.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(JSON.parse(await readFile(join(sessionPath, 'decision-' + current.decision_id + '.json'), 'utf8')).decision_id, current.decision_id);
    if (scenario === 'slow-read') {
      await new Promise(resolve => setTimeout(resolve, 170));
      assert.equal((await lstat(oldPath)).isFile(), true, 'A late cleanup read cannot prune after cancellation');
    }
    });
  }
});

// Automatic shadow reads must neither refresh the Git index nor execute repository filter commands.
test('context_capture_keeps_git_reads_inert', async () => {
  const root = await createStateRepository();
  const git = args => assert.equal(spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture',
    '-c', 'user.email=fixture@example.invalid', ...args], { cwd: root, env: gitEnvironment }).status, 0);
  await writeFile(join(root, '.gitattributes'), 'src/example.mjs filter=fixture\n');
  git(['add', '.']); git(['commit', '-m', 'Read-only fixture']);
  const indexPath = join(root, '.git/index');
  const indexBefore = await readFile(indexPath);
  const changedTime = new Date(Date.now() + 2000);
  await utimes(join(root, 'src/example.mjs'), changedTime, changedTime);
  await captureContextTask(hookInput(root), null);
  assert.deepEqual(await readFile(indexPath), indexBefore, 'Shadow capture must leave cached index metadata unchanged');

  const marker = join(root, '.git/filter-ran');
  const filterProgram = join(root, '.git/fixture-clean.sh');
  await writeFile(filterProgram, '#!/bin/sh\n/usr/bin/touch "' + marker + '"\n/bin/cat\n');
  git(['config', 'filter.fixture.clean', '/bin/sh ' + filterProgram]);
  await writeFile(join(root, 'src/example.mjs'), 'export const value = 2;\n');
  await captureContextTask(hookInput(root), null);
  assert.equal(await lstat(marker).catch(error => { if (error.code === 'ENOENT') return null; throw error; }), null);
});

// Git filters introduced after initial checks, including child repository filters, must stay inert.
test('context_capture_never_converts_working_files_through_git_filters', async () => {
  const git = (root, args) => assert.equal(spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture',
    '-c', 'user.email=fixture@example.invalid', ...args], { cwd: root, env: gitEnvironment }).status, 0);
  for (const scenario of ['submodule', 'concurrent-filter']) {
    const root = await createStateRepository();
    let filteredRoot = root;
    if (scenario === 'submodule') {
      const source = await createStateRepository();
      await writeFile(join(source, '.gitattributes'), 'src/example.mjs filter=fixture\n');
      git(source, ['add', '.']); git(source, ['commit', '-m', 'Child fixture']);
      git(root, ['-c', 'protocol.file.allow=always', 'submodule', 'add', source, 'child']);
      filteredRoot = join(root, 'child');
    } else await writeFile(join(root, '.gitattributes'), 'src/example.mjs filter=fixture\n');
    git(root, ['add', '.']); git(root, ['commit', '-m', 'Parent fixture']);
    const marker = join(root, '.git/filter-executed');
    const program = join(root, '.git/fixture-filter.sh');
    await writeFile(program, '#!/bin/sh\n/usr/bin/touch "' + marker + '"\n/bin/cat\n');
    if (scenario === 'submodule') git(filteredRoot, ['config', 'filter.fixture.clean', '/bin/sh ' + program]);
    await writeFile(join(filteredRoot, 'src/example.mjs'), 'export const value = 2;\n');
    const realOpen = contextFileSystem.open;
    let injected = false;
    const interception = mock.method(contextFileSystem, 'open', async (path, ...args) => {
      if (scenario === 'concurrent-filter' && !injected && path === join(root, 'src/example.mjs')) {
        injected = true; git(root, ['config', 'filter.fixture.clean', '/bin/sh ' + program]);
      }
      return realOpen(path, ...args);
    });
    syncBuiltinESMExports();
    try { await captureContextTask(hookInput(root), null).catch(() => {}); }
    finally { interception.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(await lstat(marker).catch(error => { if (error.code === 'ENOENT') return null; throw error; }), null,
      'Automatic capture must not execute the ' + scenario + ' conversion command');
  }
});

// A state too large for its reader must not replace a usable prior task.
test('context_state_write_limit_preserves_the_previous_task', async () => {
  const root = await createStateRepository();
  const stateDir = join(temporaryRoot, 'state-size-limit');
  const initial = await captureContextTask(hookInput(root), null);
  await saveContextTask(stateDir, initial);
  const oversized = { ...initial, previous_state_hash: createHash('sha256').update(JSON.stringify(initial)).digest('hex'),
    protected_requirements: Array.from({ length: 40000 }, (_, index) => 'path:long-explicit-path-' + index) };
  await assert.rejects(saveContextTask(stateDir, oversized), /Context task state.*limit/);
  assert.deepEqual(await readContextTask(stateDir, root, initial.session_id), initial);
});

// Failed temporary creation or cleanup must not leave the owning session locked forever.
test('context_state_failures_release_the_owned_lock', async () => {
  const root = await createStateRepository();
  const state = await captureContextTask(hookInput(root), null);
  const realOpen = contextFileSystem.open; const realUnlink = contextFileSystem.unlink;
  for (const failure of ['open', 'cleanup']) {
    const stateDir = join(temporaryRoot, 'failed-write-' + failure);
    const opening = mock.method(contextFileSystem, 'open', async (path, ...args) => {
      if (path.includes('/.task-') && failure === 'open') throw Object.assign(new Error('Fixture open failure'), { code: 'EACCES' });
      const file = await realOpen(path, ...args);
      if (path.includes('/.task-')) file.sync = async () => { throw Object.assign(new Error('Fixture sync failure'), { code: 'EIO' }); };
      return file;
    });
    const removing = mock.method(contextFileSystem, 'unlink', async path => {
      if (path.includes('/.task-')) throw Object.assign(new Error('Fixture cleanup failure'), { code: 'EACCES' });
      return realUnlink(path);
    });
    syncBuiltinESMExports();
    try { await assert.rejects(saveContextTask(stateDir, state), error => ['EACCES', 'EIO'].includes(error.code)); }
    finally { opening.mock.restore(); removing.mock.restore(); syncBuiltinESMExports(); }
    const repository = (await readdir(stateDir))[0];
    const session = (await readdir(join(stateDir, repository)))[0];
    assert.equal((await readdir(join(stateDir, repository, session))).includes('.task.lock'), false,
      'A failed ' + failure + ' must release its own lock');
    assert.equal(await saveContextTask(stateDir, state), true);
  }
});

// A filename embedded in another path must not become a separately requested protected file.
test('context_explicit_paths_match_complete_literal_names', async () => {
  const root = await createStateRepository();
  await mkdir(join(root, 'lib/src'), { recursive: true });
  await writeFile(join(root, 'lib/src/example.mjs'), 'export const nested = true;\n');
  await writeFile(join(root, 'src/naïve example.mjs'), 'export const unicode = true;\n');
  for (const [prompt, expected] of [
    ['Inspect lib/src/example.mjs.', ['lib/src/example.mjs']],
    ['Inspect ./src/example.mjs.', ['src/example.mjs']],
    ['Inspect `src/naïve example.mjs`.', ['src/naïve example.mjs']],
    ['Inspect src/example.mjs.backup.', []],
  ]) {
    const state = await captureContextTask(hookInput(root, 'literal-paths', { prompt }), null);
    assert.deepEqual(resolveContextFacts(state).explicit_paths, expected);
  }
});

// Completion idioms cannot widen scope, and partial recovery cannot erase a missing turn.
test('context_scope_and_gap_recovery_require_explicit_requests', async () => {
  const root = await createStateRepository();
  const documentation = await captureContextTask(hookInput(root, 'documentation', {
    prompt: 'Explain the review documentation warning about dynamic dependencies.' }), null);
  assert.equal(resolveContextDecision(documentation, resolveContextFacts(documentation), null).operation, 'documentation_context');
  for (const prompt of ['todo bien', "that's all", 'All good.', 'every time', 'todo listo', 'completa la tarea', 'all now']) {
    const state = await captureContextTask(hookInput(root, 'scope', { prompt }), null);
    assert.equal(resolveContextFacts(state).exhaustive, false, prompt + ' is not an exhaustive coverage request');
  }
  for (const prompt of ['Find every archiveRecord occurrence.', 'Review all hunks.', 'List every tracked file.', 'Find all files importing issue-summary.']) {
    const state = await captureContextTask(hookInput(root, 'explicit-scope', { prompt }), null);
    assert.equal(resolveContextFacts(state).exhaustive, true, 'Explicit quantified scope must stay protected');
  }
  const previous = { ...await captureContextTask(hookInput(root), null), history_gap: true, continuity: 'unknown' };
  for (const prompt of ['y también los tests', 'and also the tests', 'eso también']) {
    const state = await captureContextTask(hookInput(root, 'session-one', { prompt }), previous);
    assert.equal(state.continuity, 'unknown'); assert.equal(state.history_gap, true);
    assert.equal(minimizeJevState(state, resolveContextFacts(state)), null);
  }
});

// Expiry must remove old owned content from retired sessions while preserving active writers and foreign files.
test('context_retention_prunes_retired_owned_sessions', async () => {
  const root = await createStateRepository(); const stateDir = join(temporaryRoot, 'retired-sessions');
  for (const session of ['retired', 'locked']) {
    const state = await captureContextTask(hookInput(root, session), null);
    state.updated_at = new Date(Date.now() - 8 * 86400000).toISOString();
    await saveContextTask(stateDir, state);
    const decision = resolveContextDecision(state, resolveContextFacts(state), null);
    await recordContextDecision(stateDir, state, decision);
    const path = join(stateDir, createHash('sha256').update(root).digest('hex'), createHash('sha256').update(session).digest('hex'));
    const recordPath = join(path, 'decision-' + decision.decision_id + '.json');
    const record = JSON.parse(await readFile(recordPath, 'utf8')); record.updated_at = state.updated_at;
    await writeFile(recordPath, JSON.stringify(record)); await writeFile(join(path, 'foreign.json'), 'Preserve this file.');
    if (session === 'locked') await writeFile(join(path, '.task.lock'), '', { mode: 0o600 });
  }
  const active = await captureContextTask(hookInput(root, 'active'), null);
  await recordContextDecision(stateDir, active, resolveContextDecision(active, resolveContextFacts(active), null));
  for (const session of ['retired', 'locked']) {
    const path = join(stateDir, createHash('sha256').update(root).digest('hex'), createHash('sha256').update(session).digest('hex'));
    const files = await readdir(path);
    assert.equal(files.includes('task.json'), session === 'locked');
    assert.equal(files.some(name => name.startsWith('decision-')), session === 'locked');
    assert.equal(await readFile(join(path, 'foreign.json'), 'utf8'), 'Preserve this file.');
  }
});
