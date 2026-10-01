import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, writeFile, readFile, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import * as contextResults from '../src/context-results.mjs';
import { captureContextTask, saveContextTask, recordContextDecision, resolveContextDecision, resolveContextFacts } from '../src/context-state.mjs';
import { selectCodeContext } from '../src/repository-context.mjs';

const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'context-reuse-tests-')));
after(() => assert.equal(spawnSync('trash', [temporaryRoot]).status, 0));
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const gitEnvironment = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

async function reuseFixture() {
  const root = await mkdtemp(join(temporaryRoot, 'repository-'));
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, env: gitEnvironment });
  git(['-c', 'init.templateDir=', 'init', '--initial-branch=fixture-main']);
  git(['config', 'core.excludesFile', '/dev/null']); git(['config', 'core.attributesFile', '/dev/null']);
  const content = '\uFEFFexport const originalEvidence = 17;\r\n' + '// exact whole evidence\r\n'.repeat(100);
  await writeFile(join(root, 'input.mjs'), content);
  git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture: exact evidence']);
  const state = await captureContextTask({ cwd: root, session_id: 'reuse-session', turn_id: 'reuse-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Explain input.mjs.', permission_mode: 'read-only',
    versions: { policy_hash: hash('policy'), questions_hash: hash('questions'), jev_model: null } }, null);
  const stateDir = join(root, '..', hash(root)); assert.equal(await saveContextTask(stateDir, state), true);
  const request = { repo_root: root, state_dir: stateDir, session_id: state.session_id, request_hash: state.request_hash,
    repo_revision: state.repo_revision, context_epoch: state.context_epoch, paths: ['input.mjs'], symbols: [],
    scope: { kind: 'worktree' }, family: 'code_context', exhaustive: false, byte_limit: 1200 };
  return { root, state, stateDir, request, content, sessionPath: join(stateDir, hash(root), hash(state.session_id)) };
}

// Losing any receipt binding or trusting preparation/unknown availability would suppress required evidence.
test('reuse_requires_current_delivery', () => {
  assert.equal(typeof contextResults.reuseContextDelivery, 'function', 'A current delivery guard is required');
  const bundle = { status: 'ok', entries: [{ content: 'exact' }], full_result: hash('result') };
  const current = { session_id: 'session', turn_id: 'turn', context_epoch: 'epoch', request_hash: hash('request'),
    repo_revision: hash('revision'), corpus_hash: hash('corpus'), permissions_hash: hash('permissions'),
    versions: { policy: 'one', questions: 'one', jev_model: 'pinned-one' }, continuity: 'known',
    context_availability: 'confirmed', history_gap: false };
  const receipt = { ...current, bundle_hash: hash(bundle), delivery_confirmed: true };
  assert.deepEqual(contextResults.reuseContextDelivery(bundle, receipt, current), { action: 'reuse', reference: bundle.full_result });
  for (const key of ['session_id', 'turn_id', 'context_epoch', 'request_hash', 'repo_revision', 'corpus_hash', 'permissions_hash', 'versions']) {
    const changed = { ...current, [key]: key === 'versions' ? { policy: 'two' } : 'changed' };
    assert.deepEqual(contextResults.reuseContextDelivery(bundle, receipt, changed), { action: 'prefetch', reference: null }, key);
  }
  for (const changed of [{ ...current, context_availability: 'unknown' }, { ...current, history_gap: true },
    { ...current, continuity: 'unknown' }, { ...current, context_epoch: 'compacted' }])
    assert.equal(contextResults.reuseContextDelivery(bundle, receipt, changed).action, 'prefetch');
  assert.equal(contextResults.reuseContextDelivery({ ...bundle, entries: [{ content: 'new candidate' }] }, receipt, current).action, 'prefetch');
  assert.equal(contextResults.reuseContextDelivery(bundle, { ...receipt, delivery_confirmed: false }, current).action, 'prefetch');
  assert.deepEqual(contextResults.reuseContextDelivery(bundle, null, current), { action: 'prefetch', reference: null });
});

// Repeating the exact read must reuse private storage; edits and epoch changes must reject old references.
test('context_result_storage_deduplicates_without_suppressing_evidence', async () => {
  const { root, state, stateDir, request, content, sessionPath } = await reuseFixture();
  const first = await selectCodeContext(request); assert.equal(first.status, 'ok', first.stderr);
  const second = await selectCodeContext(request); assert.equal(second.status, 'ok', second.stderr);
  assert.equal(second.full_result, first.full_result, 'Repeated current evidence must reuse its private artifact');
  assert.deepEqual(second, first, 'Deduplication must resend identical evidence and continuations');
  assert.equal((await readdir(sessionPath)).filter(name => name.startsWith('result-')).length, 1);
  const whole = await contextResults.readContext({ ...request, reference: first.full_result, cursor: first.omissions[0].cursor });
  assert.equal(whole.entries[0].content, content);
  await writeFile(join(root, 'input.mjs'), content.replace('17', '18'));
  assert.equal((await contextResults.readContext({ ...request, reference: first.full_result })).status, 'stale');
  const updated = await captureContextTask({ cwd: root, session_id: state.session_id, turn_id: 'reread-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Explain input.mjs.', permission_mode: 'read-only', versions: state.versions }, state);
  assert.equal(await saveContextTask(stateDir, updated), true);
  const reread = await selectCodeContext({ ...request, repo_revision: updated.repo_revision });
  assert.equal(reread.status, 'ok', reread.stderr); assert.notEqual(reread.full_result, first.full_result);
  const compacted = await captureContextTask({ cwd: root, session_id: state.session_id, turn_id: 'recovered-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Explain input.mjs.', permission_mode: 'read-only',
    versions: state.versions, context_epoch: 'new-context-epoch' }, updated);
  assert.equal(await saveContextTask(stateDir, compacted), true);
  assert.equal((await contextResults.readContext({ ...request, reference: reread.full_result })).status, 'error');
  const recovered = await selectCodeContext({ ...request, repo_revision: compacted.repo_revision, context_epoch: compacted.context_epoch });
  const expanded = await contextResults.readContext({ ...request, reference: recovered.full_result, cursor: recovered.omissions[0].cursor });
  assert.equal(expanded.entries[0].content, content.replace('17', '18'));
});

// Expiry must remove only verified owned expired bytes, never fresh results, foreign names or symlink targets.
test('context_result_expiry_removes_owned_expired_artifacts', async () => {
  const { root, state, stateDir, request, sessionPath } = await reuseFixture();
  const page = await selectCodeContext(request);
  const artifact = JSON.parse(await readFile(join(sessionPath, 'result-' + page.full_result + '.json'), 'utf8'));
  const expired = JSON.stringify({ ...artifact, created_at: new Date(Date.now() - 8 * 86400000).toISOString() });
  const expiredName = 'result-' + hash(expired) + '.json';
  await writeFile(join(sessionPath, expiredName), expired, { mode: 0o600 });
  const foreignName = 'result-' + hash('foreign') + '.json';
  await writeFile(join(sessionPath, foreignName), expired, { mode: 0o600 });
  const target = join(temporaryRoot, 'foreign-target.json'); await writeFile(target, expired, { mode: 0o600 });
  const linkName = 'result-' + hash('symlink') + '.json'; await symlink(target, join(sessionPath, linkName));
  const decision = resolveContextDecision(state, resolveContextFacts(state), null);
  assert.equal(await recordContextDecision(stateDir, state, decision), true);
  const names = await readdir(sessionPath);
  assert.equal(names.includes(expiredName), false, 'Expired owned full results must be physically removed');
  for (const name of ['result-' + page.full_result + '.json', foreignName, linkName]) assert.ok(names.includes(name), name);
  assert.equal(await readFile(target, 'utf8'), expired);
  assert.equal(root, artifact.repo_root);
});
