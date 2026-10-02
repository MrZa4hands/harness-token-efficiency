import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, writeFile, readFile, readdir, symlink, utimes, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import * as contextResults from '../src/context-results.mjs';
import { captureContextTask, saveContextTask, recordContextDecision, resolveContextDecision, resolveContextFacts, readContextTask } from '../src/context-state.mjs';
import { selectCodeContext, getRepositoryChanges } from '../src/repository-context.mjs';
import { prepareCodexContext } from '../src/context-prefetch.mjs';

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

// A newer private task must not be used to publish evidence captured by an older producer.
test('context_publication_rejects_original_producer_identity_changes', async () => {
  const { state, stateDir, root, request } = await reuseFixture();
  const changed = await captureContextTask({ cwd: root, session_id: state.session_id, turn_id: 'new-turn',
    hook_event_name: 'UserPromptSubmit', prompt: state.active_request.text, permission_mode: 'restricted',
    versions: { ...state.versions, policy_hash: hash('changed-policy') } }, state);
  assert.equal(await saveContextTask(stateDir, changed), true);
  for (const operation of [selectCodeContext, getRepositoryChanges]) {
    const result = await operation({ ...request, execution_task: state });
    assert.equal(result.status, 'error'); assert.equal(result.full_result, null);
    assert.match(result.stderr, /binding/);
  }
});

// Optional expired-log work must not exhaust the deadline before recovering the requested failed check.
test('requested_check_recovery_precedes_expiry_backlog', async () => {
  const { state, request, sessionPath } = await reuseFixture();
  const content = 'Original failed-check diagnosis.\n';
  const bundle = { kind: 'project-check', status: 'error', exit_code: 7, request_hash: state.request_hash,
    repo_revision: state.repo_revision, context_epoch: state.context_epoch, entries: [
      { kind: 'check-output', path: 'stderr', stream: 'stderr', encoding: 'utf8', content, sha256: hash(content) }],
    stderr: content, coverage_status: 'complete', output_complete: true };
  const page = await contextResults.storeContextResult(bundle, { ...request, byte_limit: 8000 });
  const artifact = JSON.parse(await readFile(join(sessionPath, 'result-' + page.full_result + '.json'), 'utf8'));
  const retired = join(sessionPath, '..', hash('retired')); await mkdir(retired, { mode: 0o700 });
  for (let index = 0; index < 40; index++) {
    const text = JSON.stringify({ ...artifact, session_id: 'retired', created_at: new Date(Date.now() - 8 * 86400000).toISOString(),
      bundle: { ...bundle, index, entries: [{ content: 'x'.repeat(8_000_000) }] } });
    await writeFile(join(retired, 'result-' + hash(text) + '.json'), text, { mode: 0o600 });
  }
  const recovered = await contextResults.readContext({ ...request, reference: page.full_result,
    byte_limit: 8000, signal: AbortSignal.timeout(100) });
  assert.equal(recovered.exit_code, 7); assert.equal(recovered.entries[0]?.content, content);
});

// Automatic review paging must not run the explicit-read large-artifact expiry sweep.
test('automatic_prefetch_does_not_expire_large_retired_results', async () => {
  const { root, stateDir, state, sessionPath } = await reuseFixture();
  for (let index = 0; index < 8; index++) await writeFile(join(root, 'changed-' + index + '.mjs'), 'export const changed = 1;\n');
  const current = await captureContextTask({ cwd: root, session_id: state.session_id, turn_id: state.turn_id,
    hook_event_name: 'UserPromptSubmit', prompt: 'Review all changes.', permission_mode: 'read-only', versions: state.versions }, state);
  assert.equal(await saveContextTask(stateDir, current), true);
  const request = { repo_root: root, state_dir: stateDir, session_id: current.session_id, request_hash: current.request_hash,
    repo_revision: current.repo_revision, context_epoch: current.context_epoch, scope: { kind: 'worktree' }, byte_limit: 2200 };
  assert.ok((await getRepositoryChanges(request)).next_cursor, 'Actual automatic review must traverse result pages');
  const retired = join(sessionPath, '..', hash('retired')); await mkdir(retired, { mode: 0o700 });
  const text = JSON.stringify({ schema_version: 2, repo_root: root, session_id: 'retired',
    created_at: new Date(Date.now() - 8 * 86400000).toISOString(), binding_hash: hash('owned'), bundle: { content: 'x'.repeat(2_000_000) } });
  const expired = join(retired, 'result-' + hash(text) + '.json'); await writeFile(expired, text, { mode: 0o600 });
  await prepareCodexContext(current, { action: 'prefetch', operation: 'code_review_context', fallback_reason: null },
    current.versions, { state_dir: stateDir });
  await assert.doesNotReject(access(expired), 'Large retired logs are outside automatic prompt maintenance');
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

// Killing a writer during persistence must not publish a partial deterministic artifact that poisons identical retries.
test('context_result_atomic_publication_survives_interrupted_writer', async () => {
  const fixture = await reuseFixture();
  const script = join(temporaryRoot, 'atomic-writer.mjs');
  await writeFile(script, `import {storeContextResult} from ${JSON.stringify(new URL('../src/context-results.mjs', import.meta.url).href)};
import {createHash} from 'node:crypto';
const request=${JSON.stringify(fixture.request)};
const content='\\0'.repeat(6_000_000);
const hash=value=>createHash('sha256').update(value).digest('hex');
const bundle={kind:'project-check',name:'atomic-fixture',status:'ok',exit_code:0,error:null,stdout:'',stderr:'',output_complete:true,
entries:[{kind:'check-output',path:'stdout',stream:'stdout',encoding:'utf8',content,sha256:hash(content)}],
omissions:[],omitted_count:0,coverage_status:'complete',next_cursor:null,full_result:null,
request_hash:request.request_hash,repo_revision:request.repo_revision,context_epoch:request.context_epoch};
try{console.log(JSON.stringify(await storeContextResult(bundle,request)))}catch(error){console.error(error.message);process.exitCode=1}
`, { mode: 0o600 });
  const child = spawn(process.execPath, [script], { stdio: 'ignore' });
  const closed = new Promise(resolveExit => child.on('close', resolveExit));
  const watcher = watch(fixture.sessionPath, (event, name) => {
    if (event === 'rename' && /^(?:result-|\.result-)/.test(String(name))) child.kill('SIGKILL');
  });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
  await closed; clearTimeout(deadline); watcher.close();
  assert.equal((await readdir(fixture.sessionPath)).some(name => name.startsWith('result-')), false,
    'Only a fully written artifact may occupy its deterministic recovery name');
  const retry = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 5000 });
  assert.equal(retry.status, 0, retry.stderr); assert.equal(JSON.parse(retry.stdout).status, 'ok');
});

// Prompt cleanup stays bounded, while an explicit read completes physical expiry of a large owned artifact.
test('explicit_context_read_expires_large_owned_results', async () => {
  const fixture = await reuseFixture();
  const artifact = { schema_version: 2, repo_root: fixture.root, session_id: fixture.state.session_id,
    created_at: new Date(Date.now() - 8 * 86400000).toISOString(), binding_hash: hash('old-binding'),
    bundle: { entries: [{ content: '\0'.repeat(6_000_000) }] } };
  const text = JSON.stringify(artifact); const reference = hash(text); const path = join(fixture.sessionPath, 'result-' + reference + '.json');
  await writeFile(path, text, { mode: 0o600 });
  const result = await contextResults.readContext({ ...fixture.request, reference });
  assert.equal(result.status, 'error');
  assert.equal((await readdir(fixture.sessionPath)).includes('result-' + reference + '.json'), false,
    'Owned expired large result must be physically removed by explicit maintenance');
});

// Interrupted owned writes with expired metadata may expire; foreign and unverifiable temporary bytes remain untouched.
test('owned_interrupted_context_write_expires_without_removing_foreign_temporary', async () => {
  const fixture = await reuseFixture();
  const age = new Date(Date.now() - 8 * 86400000);
  const header = { schema_version: 2, repo_root: fixture.root, session_id: fixture.state.session_id,
    created_at: age.toISOString(), binding_hash: hash('binding') };
  const owned = '.result-12345678-1234-4123-8123-123456789abc.tmp';
  const foreign = '.result-12345678-1234-4123-8123-123456789abd.tmp';
  const unknown = '.result-12345678-1234-4123-8123-123456789abe.tmp';
  await writeFile(join(fixture.sessionPath, owned), JSON.stringify(header).slice(0, -1) + ',"bundle":{"unfinished":', { mode: 0o600 });
  await writeFile(join(fixture.sessionPath, foreign), JSON.stringify({ ...header, repo_root: '/foreign/repository' }).slice(0, -1) + ',"bundle":', { mode: 0o600 });
  await writeFile(join(fixture.sessionPath, unknown), 'unverified bytes', { mode: 0o600 });
  for (const name of [owned, foreign, unknown]) await utimes(join(fixture.sessionPath, name), age, age);
  const decision = resolveContextDecision(fixture.state, resolveContextFacts(fixture.state), null);
  await recordContextDecision(fixture.stateDir, fixture.state, decision);
  const names = await readdir(fixture.sessionPath);
  assert.equal(names.includes(owned), false); assert.ok(names.includes(foreign)); assert.ok(names.includes(unknown));
});

// Routine preview fitting must not repeatedly serialize megabytes per removed preview line.
test('check_page_preview_fitting_keeps_bulk_serialization_bounded', () => {
  const content = '\n'.repeat(2_000_000);
  const bundle = { kind: 'project-check', name: 'large', status: 'error', exit_code: 7, error: null,
    stdout: 'x\n'.repeat(600), stderr: 'y\n'.repeat(600), output_complete: true, coverage_status: 'complete',
    entries: [{ kind: 'check-output', path: 'stdout', stream: 'stdout', encoding: 'utf8', sha256: hash(content), content }],
    request_hash: hash('request'), repo_revision: hash('revision'), context_epoch: 'epoch' };
  const started = performance.now();
  const page = contextResults.pageContextResult(bundle, hash('result'), null, 1680);
  assert.ok(performance.now() - started < 1000, 'Preview fitting must leave the execution deadline responsive');
  assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1680); assert.equal(page.omissions.length, 1);
});

// Reusing exact current private evidence must perform no writes, including transient persistence work.
test('identical_context_result_reuse_does_not_write_temporary_files', async () => {
  const fixture = await reuseFixture(); const temporaryNames = new Set();
  const watcher = watch(fixture.sessionPath, (event, name) => {
    if (String(name).startsWith('.result-') && String(name).endsWith('.tmp')) temporaryNames.add(String(name));
  });
  try {
    const first = await selectCodeContext(fixture.request);
    const second = await selectCodeContext(fixture.request);
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
    assert.deepEqual(second, first); assert.equal(temporaryNames.size, 1, 'Only the cold write may create a temporary');
  } finally { watcher.close(); }
});

// Removing an expired task must not strand its large result; a current sibling's explicit read completes owned expiry.
test('explicit_context_read_expires_large_retired_session_results', async () => {
  const fixture = await reuseFixture(); const age = new Date(Date.now() - 8 * 86400000).toISOString();
  const retired = { ...fixture.state, updated_at: age, previous_state_hash: hash(fixture.state) };
  assert.equal(await saveContextTask(fixture.stateDir, retired), true);
  const text = JSON.stringify({ schema_version: 2, repo_root: fixture.root, session_id: retired.session_id,
    created_at: age, binding_hash: hash('old-binding'), bundle: { entries: [{ content: 'x'.repeat(2_000_000) }] } });
  const expiredName = 'result-' + hash(text) + '.json';
  await writeFile(join(fixture.sessionPath, expiredName), text, { mode: 0o600 });
  const active = await captureContextTask({ cwd: fixture.root, session_id: 'active-sibling', turn_id: 'active-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Explain input.mjs.', permission_mode: 'read-only', versions: fixture.state.versions }, null);
  assert.equal(await saveContextTask(fixture.stateDir, active), true);
  await recordContextDecision(fixture.stateDir, active, resolveContextDecision(active, resolveContextFacts(active), null));
  assert.equal(await readContextTask(fixture.stateDir, fixture.root, retired.session_id), null);
  const request = { ...fixture.request, session_id: active.session_id, request_hash: active.request_hash,
    repo_revision: active.repo_revision, context_epoch: active.context_epoch };
  const page = await selectCodeContext(request); assert.equal(page.status, 'ok', page.stderr);
  const current = await contextResults.readContext({ ...request, reference: page.full_result });
  assert.equal(current.status, 'ok', current.stderr);
  assert.equal((await readdir(fixture.sessionPath)).includes(expiredName), false, 'Retired-session task removal cannot strand owned expired logs');
});
