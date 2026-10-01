import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, symlink, realpath, rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { captureContextTask, readContextTask, saveContextTask, resolveContextFacts,
  resolveContextDecision, recordContextDecision } from '../src/context-state.mjs';
import { minimizeJevState } from '../src/jev-client.mjs';

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
  await writeFile(configPath, JSON.stringify({ mode: 'shadow', jev_enabled: false }));
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
  await writeFile(configPath, JSON.stringify({ mode: 'off', jev_enabled: false }));
  assert.equal(invoke(hookInput(root, 'native-off')).stderr, '');
  assert.equal((await readdir(repositoryPath)).length, 2, 'Off is checked again on every invocation');
  await writeFile(configPath, JSON.stringify({ mode: 'enforce', jev_enabled: false }));
  assert.equal(invoke(hookInput(root, 'unsupported', { hook_event_name: 'PreToolUse' })).stdout, '');
  assert.equal((await readdir(repositoryPath)).length, 2);
  const enforced = invoke(hookInput(root, 'native-enforce'));
  assert.equal(enforced.stdout, '', 'Phase 1 must not inject even when enforce is requested');
  assert.equal(enforced.stderr, '');
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
