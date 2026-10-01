import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, realpath, readdir, lstat, chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { queryJevContext, minimizeJevState, discoverJevModels, configureJevModel } from '../src/jev-client.mjs';
import { resolveContextDecision } from '../src/context-state.mjs';
import { handleCodexHook } from '../src/codex-context-policy.mjs';
import { collectJevUsage } from '../src/pilot-evaluation.mjs';
import contextFileSystem from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';

const questions = JSON.parse(await readFile(new URL('../config/jev-questions.json', import.meta.url), 'utf8'));
const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'jev-contract-tests-')));
after(() => assert.equal(spawnSync('trash', [temporaryRoot]).status, 0));
const minimalState = { request: 'Where does malformed configuration get rejected?', active_goal: null,
  continuity: 'new', facts: { explicit_path_count: 0, literal_symbol_count: 0, exhaustive: false, change_scope: null } };
function goodResponse() {
  return { model: 'jev-fixture-actual', answers: {
    continues_active_goal: { type: 'noul', noul: 0.01 },
    needs_repository_context: { type: 'noul', noul: 0.99 },
    needs_change_context: { type: 'noul', noul: 0.01 },
    needs_documentation_context: { type: 'noul', noul: 0.01 },
    requires_exhaustive_coverage: { type: 'noul', noul: 0.01 },
    context_operation: { type: 'choice', choice: 'code_context', confidence: 0.99,
      probabilities: { code_context: 0.97, code_review_context: 0.01, documentation_context: 0.01, baseline: 0.01 } },
  }, usage: { input_tokens: 170, output_tokens: 18 } };
}
const request = { model: 'jev-fixture-alias', state: minimalState, questions };

// Accepting an incomplete/invalid classifier contract or retrying failed requests must fail this boundary.
test('jev_contract_and_abstention', async () => {
  let calls = 0;
  const invoke = (body, status = 200) => queryJevContext(request, { apiKey: 'fixture-key',
    signal: AbortSignal.timeout(2000), fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
      assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer fixture-key');
      assert.deepEqual(JSON.parse(options.body), request);
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    } });
  const good = await invoke(goodResponse());
  assert.equal(good.status, 'ok', 'A valid named-answer contract must be available for shadow decisions');
  assert.equal(good.response.model, 'jev-fixture-actual');
  assert.deepEqual(good.response.usage, { input_tokens: 170, output_tokens: 18 });
  assert.equal(calls, 1);
  const changedModel = await queryJevContext(request, { apiKey: 'fixture-key', expectedActualModel: 'jev-fixture-pinned',
    fetchImpl: async () => new Response(JSON.stringify(goodResponse())) });
  assert.equal(changedModel.status, 'abstain', 'A changed actual model cannot reuse calibrated decisions');
  assert.equal(changedModel.fallback_reason, 'changed-actual-model');
  assert.equal(changedModel.actual_model, 'jev-fixture-actual');
  assert.deepEqual(changedModel.provider_usage, { input_tokens: 170, output_tokens: 18 });
  assert.equal(changedModel.request_sent, true);
  const malformed = goodResponse(); malformed.answers.context_operation.probabilities.baseline = 0.8;
  const rejectedAnswers = await invoke(malformed);
  assert.equal(rejectedAnswers.status, 'abstain');
  assert.equal(rejectedAnswers.actual_model, 'jev-fixture-actual');
  assert.deepEqual(rejectedAnswers.provider_usage, { input_tokens: 170, output_tokens: 18 },
    'Malformed classifier answers must not discard independently valid billable usage');
  const mutations = [
    response => { delete response.answers.needs_repository_context; },
    response => { response.answers.needs_repository_context.type = 'choice'; },
    response => { response.answers.needs_repository_context.noul = 1.1; },
    response => { response.answers.needs_repository_context.noul = NaN; },
    response => { response.answers.needs_repository_context.confidence = 0.99; },
    response => { response.answers.context_operation.choice = 'generated-command'; },
    response => { response.answers.context_operation.probabilities.baseline = 0.9; },
    response => { response.answers.context_operation.choice = 'baseline'; },
    response => { response.answers.context_operation.confidence = -0.1; },
    response => { response.answers.context_operation.probabilities.extra = 0; },
    response => { response.usage.input_tokens = -1; },
    response => { response.usage.output_tokens = 0.5; },
    response => { response.model = ''; },
    response => { response.extra = 'unexpected'; },
  ];
  for (const mutate of mutations) {
    const response = goodResponse(); mutate(response);
    const before = calls;
    assert.equal((await invoke(response)).status, 'abstain');
    assert.equal(calls, before + 1, 'Invalid responses must never cause a repair request');
  }
  assert.equal((await invoke('{invalid')).status, 'abstain');
  for (const status of [401, 429, 500, 503]) {
    const before = calls;
    assert.equal((await invoke({ error: 'SYNTHETIC_PROVIDER_PRIVATE_ERROR' }, status)).fallback_reason, 'http-' + status);
    assert.equal(calls, before + 1);
  }
  let timeoutCalls = 0; let canceled = false;
  const timedOut = await queryJevContext(request, { apiKey: 'fixture-key', signal: AbortSignal.timeout(2000),
    fetchImpl: async (url, options) => { timeoutCalls++;
      return await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
        canceled = true; reject(options.signal.reason);
      }, { once: true }));
    } });
  assert.equal(timedOut.fallback_reason, 'timeout'); assert.equal(timeoutCalls, 1); assert.equal(canceled, true);
  assert.ok(timedOut.duration_ms < 1400);
});

// Leaking source, credentials, or an oversized question set must be rejected before the network boundary.
test('jev_minimization_and_zero_call_guards', async () => {
  const sourceState = { recent_requests: [{ text: minimalState.request }], active_request: { text: minimalState.request }, continuity: 'new' };
  const facts = { explicit_paths: [], literal_symbols: [], exhaustive: false, change_scope: null };
  assert.deepEqual(minimizeJevState(sourceState, facts), minimalState);
  const unsafeTexts = ['Use github_pat_SYNTHETIC_PRIVATE_TOKEN_TO_REJECT', 'Authorization: Bearer synthetic-secret',
    'API_KEY=synthetic-secret', '```js\nexport const privateSource = 1;\n```', '-----BEGIN PRIVATE KEY-----',
    'Read https://user:password@example.invalid', 'export const privateSource = "hidden";', 'x'.repeat(2000),
    'Explain postgres://fixture-user:fixture-password@example.invalid/db',
    'Explain mysql://fixture-user:fixture-password@example.invalid/db',
    'Explain redis://fixture-user:fixture-password@example.invalid/db',
    'Explain `const internalValue = 1;`', 'Explain let internalValue = 1;',
    'Explain SELECT private_value FROM internal_table;', 'My password is fixture-pass',
    'Mi contraseña es fixture-pass', 'My PIN is 1234', 'My token is fixture-pass',
    'Mi token es fixture-pass', 'My secret is fixture-pass', 'My credential is fixture-pass',
    'Mi secreto es fixture-pass', 'Mi credencial es fixture-pass'];
  for (const text of unsafeTexts) {
    assert.equal(minimizeJevState({ ...sourceState, recent_requests: [{ text }], active_request: { text } }, facts), null);
    assert.equal(minimizeJevState({ ...sourceState, active_request: { text }, continuity: 'unknown' }, facts), null,
      'The active goal must have the same privacy boundary as the current request');
  }
  assert.notEqual(minimizeJevState({ ...sourceState, recent_requests: [{ text: 'Locate `normalizeLabel` in `src/label-policy.mjs`.' }] }, facts), null);
  let calls = 0;
  const options = { apiKey: 'fixture-key', signal: AbortSignal.timeout(2000), fetchImpl: async () => { calls++; return new Response('{}'); } };
  const cases = [
    [{ ...request, state: { ...minimalState, request: 'github_pat_SYNTHETIC_PRIVATE_TOKEN' } }, options],
    [{ ...request, questions: { ...questions, extra: { type: 'noul', instructions: 'x'.repeat(6000) } } }, options],
    [{ ...request, questions: { needs_repository_context: questions.needs_repository_context } }, options],
    [request, { ...options, apiKey: null }],
    [request, { ...options, mode: 'off' }],
    [request, { ...options, jevEnabled: false }],
    [request, { ...options, conclusiveRule: true }],
    ...unsafeTexts.map(text => [{ ...request, state: { ...minimalState, request: text } }, options]),
  ];
  for (const [input, settings] of cases) assert.equal((await queryJevContext(input, settings)).status, 'abstain');
  assert.equal(calls, 0, 'Rejected state, off, disabled Jev, and conclusive rules must not send requests');
});

// Semantically contradictory valid answers must not override explicit exhaustive or recipe facts.
test('jev_semantic_decisions_preserve_protected_facts', () => {
  const state = { versions: {}, continuity: 'new', protected_requirements: ['exhaustive_coverage'] };
  const facts = { known_operation: null, explicit_paths: [], literal_symbols: [], exhaustive: true, change_scope: null };
  const negativeExhaustive = goodResponse();
  assert.equal(resolveContextDecision(state, facts, negativeExhaustive).action, 'baseline');
  const good = goodResponse(); good.answers.requires_exhaustive_coverage.noul = 0.99;
  const decision = resolveContextDecision(state, facts, good);
  assert.equal(decision.operation, 'code_context'); assert.equal(decision.source, 'jev');
  assert.equal(decision.applied, false); assert.equal(decision.versions.jev_model, 'jev-fixture-actual');
  const contradictory = goodResponse(); contradictory.answers.needs_repository_context.noul = 0.01;
  assert.equal(resolveContextDecision({ ...state, protected_requirements: [] }, { ...facts, exhaustive: false }, contradictory).action, 'baseline');
  const uncertain = goodResponse(); uncertain.answers.needs_repository_context.noul = 0.6;
  assert.equal(resolveContextDecision({ ...state, protected_requirements: [] }, { ...facts, exhaustive: false }, uncertain).action, 'baseline');
  const differentRecipe = goodResponse(); differentRecipe.answers.needs_change_context.noul = 0.99;
  assert.equal(resolveContextDecision({ ...state, protected_requirements: [] }, { ...facts, exhaustive: false }, differentRecipe).action, 'baseline');
  const ignoresLocalReview = goodResponse(); ignoresLocalReview.answers.continues_active_goal.noul = 0.99;
  assert.equal(resolveContextDecision({ ...state, continuity: 'unknown' }, { ...facts, exhaustive: false,
    known_operation: 'code_review_context', change_scope: { kind: 'worktree' } }, ignoresLocalReview).fallback_reason,
  'contradictory-classification', 'Semantic continuity cannot discard an explicit local review scope');
  const negativeBoundary = goodResponse();
  for (const answer of Object.values(negativeBoundary.answers)) if (answer.type === 'noul' && answer.noul < 0.5) answer.noul = 0.10;
  assert.equal(resolveContextDecision({ ...state, protected_requirements: [] }, { ...facts, exhaustive: false }, negativeBoundary).action,
    'prefetch', 'An exact 0.10 negative probability is inside the declared confidence boundary');
});

// Setup must choose only authenticated returned names, never invent an available model from examples.
test('jev_model_discovery_uses_authenticated_setup_contract', async () => {
  let calls = 0;
  const discovered = await discoverJevModels({ apiKey: 'fixture-key', fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://api.typesafe.ai/v1/models'); assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer fixture-key'); assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify({ models: [{ name: 'jev-fixture-alias', description: 'Fixture only', release_date: '2026-09-10T18:38:01.391457+00:00' }] }));
  } });
  assert.equal(discovered.status, 'ok'); assert.equal(discovered.models[0].name, 'jev-fixture-alias'); assert.equal(calls, 1);
});

// A slow response body or a fetch ignoring abort cannot hold the hook beyond its own deadline.
test('jev_deadline_covers_body_and_uncooperative_transport', async () => {
  let bodyCanceled = false;
  const slowBody = await queryJevContext(request, { apiKey: 'fixture-key', signal: AbortSignal.timeout(80),
    fetchImpl: async () => new Response(new ReadableStream({ cancel() { bodyCanceled = true; } })) });
  assert.equal(slowBody.fallback_reason, 'timeout'); assert.equal(bodyCanceled, true);
  const ignoredAbort = await queryJevContext(request, { apiKey: 'fixture-key', signal: AbortSignal.timeout(80),
    fetchImpl: async () => new Promise(() => {}) });
  assert.equal(ignoredAbort.fallback_reason, 'timeout'); assert.ok(ignoredAbort.duration_ms < 400);
  const oversizedBody = await queryJevContext(request, { apiKey: 'fixture-key', fetchImpl: async () => new Response('x'.repeat(32001)) });
  assert.equal(oversizedBody.fallback_reason, 'response-too-large');
  let watchdog;
  const stalledCleanup = await Promise.race([
    queryJevContext(request, { apiKey: 'fixture-key', signal: AbortSignal.timeout(40),
      fetchImpl: async () => new Response(new ReadableStream({ cancel() { return new Promise(() => {}); } })) }),
    new Promise(resolve => { watchdog = setTimeout(() => resolve({ status: 'cleanup-exceeded-deadline' }), 300); }),
  ]);
  clearTimeout(watchdog);
  assert.equal(stalledCleanup.status, 'abstain', 'Cleanup must not wait indefinitely after the shared deadline');
});

// Setup must preserve policy controls, store no credential, and refuse undiscovered model names.
test('jev_setup_persists_only_a_discovered_model', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'setup-'));
  await mkdir(join(root, '.codex'), { mode: 0o700 });
  const configPath = join(root, '.codex/codex-context-policy.json');
  await writeFile(configPath, JSON.stringify({ mode: 'shadow', jev_enabled: true, operations: {} }), { mode: 0o600 });
  const options = { apiKey: 'SYNTHETIC_LOCAL_CREDENTIAL', fetchImpl: async () => new Response(JSON.stringify({
    models: [{ name: 'jev-fixture-alias', description: 'Fixture only', release_date: '2026-09-15' }] })) };
  const result = await configureJevModel(root, options);
  assert.equal(result.status, 'ok'); assert.equal(result.model, 'jev-fixture-alias');
  const text = await readFile(configPath, 'utf8');
  const config = JSON.parse(text);
  assert.equal(config.mode, 'shadow'); assert.equal(config.jev_model, 'jev-fixture-alias');
  assert.equal(text.includes('SYNTHETIC_LOCAL_CREDENTIAL'), false);
  assert.equal((await lstat(configPath)).mode & 0o777, 0o600);
  assert.equal((await configureJevModel(root, { ...options, model: 'not-discovered' })).status, 'abstain');
  assert.equal(await readFile(configPath, 'utf8'), text);
  await writeFile(configPath, JSON.stringify({ ...config, jev_actual_model: 'jev-fixture-old' }));
  assert.equal((await configureJevModel(root, options)).status, 'ok');
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).jev_actual_model, 'jev-fixture-old', 'Selecting the same alias preserves its explicit actual pin');
  const otherModel = { ...options, model: 'jev-fixture-new', fetchImpl: async () => new Response(JSON.stringify({
    models: [{ name: 'jev-fixture-new', description: 'New fixture', release_date: '2026-09-15' }] })) };
  assert.equal((await configureJevModel(root, otherModel)).status, 'ok');
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).jev_actual_model, undefined, 'A new selected alias requires a new actual pin');
});

// The real hook must consume one validated query, log its usage, and bypass it for deterministic/off work.
test('shadow_hook_queries_jev_only_for_unresolved_safe_requests', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'hook-'));
  const home = await mkdtemp(join(temporaryRoot, 'home-'));
  const environment = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  assert.equal(spawnSync('git', ['-c', 'init.templateDir=', 'init', '--initial-branch=fixture-main'], { cwd: root, env: environment }).status, 0);
  await writeFile(join(root, 'example.mjs'), 'export const fixture = true;\n');
  await mkdir(join(root, '.codex'), { mode: 0o700 });
  const configPath = join(root, '.codex/codex-context-policy.json');
  const config = { mode: 'shadow', jev_enabled: true, jev_model: 'jev-fixture-alias' };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const input = { cwd: root, session_id: 'jev-hook-session', turn_id: 'jev-hook-turn',
    hook_event_name: 'UserPromptSubmit', prompt: minimalState.request, permission_mode: 'read-only', model: 'fixture-model' };
  const oldFetch = globalThis.fetch; const oldHome = process.env.HOME; const oldKey = process.env.TYPESAFE_API_KEY;
  let calls = 0;
  try {
    process.env.HOME = home; process.env.TYPESAFE_API_KEY = 'fixture-key';
    globalThis.fetch = async (url, settings) => {
      calls++; assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
      const body = JSON.parse(settings.body);
      assert.equal(body.model, 'jev-fixture-alias'); assert.deepEqual(body.questions, questions);
      assert.equal(body.state.request, minimalState.request);
      return new Response(JSON.stringify(goodResponse()));
    };
    assert.deepEqual(await handleCodexHook(input), { stdout: '', stderr: '', exit_code: 0 });
    assert.equal(calls, 1, 'An eligible shadow request must call Jev once');
    const runtimeRoot = join(home, '.codex/codex-context-policy');
    const repository = (await readdir(runtimeRoot))[0];
    const session = (await readdir(join(runtimeRoot, repository)))[0];
    const sessionPath = join(runtimeRoot, repository, session);
    const record = (await readdir(sessionPath)).find(path => path.startsWith('decision-'));
    const telemetry = JSON.parse(await readFile(join(sessionPath, record), 'utf8'));
    assert.equal(telemetry.source, 'jev'); assert.equal(telemetry.applied, false);
    assert.equal(telemetry.versions.jev_model, 'jev-fixture-actual');
    assert.deepEqual(telemetry.provider_usage, { input_tokens: 170, output_tokens: 18 });
    await handleCodexHook({ ...input, session_id: 'rule', prompt: 'Inspect `example.mjs`.' });
    assert.equal(calls, 1, 'Conclusive local facts must bypass Jev');
    await writeFile(configPath, JSON.stringify({ ...config, jev_enabled: false }));
    await handleCodexHook({ ...input, session_id: 'disabled' }); assert.equal(calls, 1);
    await writeFile(configPath, JSON.stringify({ ...config, mode: 'off' }));
    await handleCodexHook({ ...input, session_id: 'off' }); assert.equal(calls, 1);
    await writeFile(configPath, JSON.stringify(config));
    globalThis.fetch = async () => {
      calls++; const response = goodResponse();
      response.answers.continues_active_goal.noul = 0.10;
      return new Response(JSON.stringify(response));
    };
    await handleCodexHook({ ...input, session_id: 'negative-boundary' });
    await handleCodexHook({ ...input, session_id: 'negative-boundary', turn_id: 'new-objective', prompt: 'What happens if the input is empty?' });
    const privateState = JSON.parse(await readFile(join(runtimeRoot, repository, createHash('sha256').update('negative-boundary').digest('hex'), 'task.json'), 'utf8'));
    assert.equal(privateState.active_request.text, 'What happens if the input is empty?',
      'A validated negative continuity observation must preserve the new explicit objective for the next turn');

    // A losing task-state writer must still account for its independently billed provider call.
    const repositoryPath = join(runtimeRoot, repository);
    const beforeSessions = await readdir(repositoryPath);
    let concurrentCalls = 0; let releaseRequests;
    const bothRequests = new Promise(resolve => { releaseRequests = resolve; });
    globalThis.fetch = async () => {
      concurrentCalls++;
      if (concurrentCalls === 2) releaseRequests();
      await bothRequests;
      return new Response(JSON.stringify(goodResponse()));
    };
    const overlapping = await Promise.all(['overlap-one', 'overlap-two'].map(turn_id => handleCodexHook({
      ...input, session_id: 'overlap-session', turn_id,
    })));
    assert.equal(overlapping.filter(result => result.stderr.includes('state conflict')).length, 1);
    const overlapSession = (await readdir(repositoryPath)).find(name => !beforeSessions.includes(name));
    const overlapPath = join(repositoryPath, overlapSession);
    const overlapRecords = await Promise.all((await readdir(overlapPath)).filter(name => name.startsWith('decision-'))
      .map(async name => JSON.parse(await readFile(join(overlapPath, name), 'utf8'))));
    assert.equal(overlapRecords.length, 2, 'Both completed billable requests must have immutable records');
    assert.equal(collectJevUsage(overlapRecords).requests, 2);
    assert.equal(collectJevUsage(overlapRecords).total_tokens, 376);
    const afterConflictCalls = concurrentCalls;
    assert.equal((await handleCodexHook({ ...input, session_id: 'overlap-session', turn_id: 'after-conflict', prompt: 'hazlo' })).stderr, '');
    assert.equal(concurrentCalls, afterConflictCalls, 'A missing concurrent turn cannot be reconstructed by Jev');
    const afterConflict = JSON.parse(await readFile(join(overlapPath, 'task.json'), 'utf8'));
    assert.equal(afterConflict.history_gap, true);
    assert.equal(afterConflict.continuity, 'unknown');
    const gapRecords = await Promise.all((await readdir(overlapPath)).filter(name => name.startsWith('decision-'))
      .map(async name => JSON.parse(await readFile(join(overlapPath, name), 'utf8'))));
    assert.equal(gapRecords.find(record => record.turn_hash === createHash('sha256').update('after-conflict').digest('hex')).fallback_reason, 'history-gap');

    const concurrentFetch = globalThis.fetch; let drifted = false;
    globalThis.fetch = async () => {
      const response = goodResponse(); response.answers.continues_active_goal.noul = 0.99;
      if (drifted) response.model = 'jev-fixture-changed';
      return new Response(JSON.stringify(response));
    };
    await handleCodexHook({ ...input, session_id: 'model-drift', prompt: 'Inspect `example.mjs`.' });
    await handleCodexHook({ ...input, session_id: 'model-drift', prompt: 'What does this code do?' });
    await handleCodexHook({ ...input, session_id: 'model-drift', prompt: 'hazlo' });
    drifted = true;
    await handleCodexHook({ ...input, session_id: 'model-drift', turn_id: 'changed-model', prompt: minimalState.request });
    const driftPath = join(repositoryPath, createHash('sha256').update('model-drift').digest('hex'));
    const driftRecords = await Promise.all((await readdir(driftPath)).filter(name => name.startsWith('decision-'))
      .map(async name => JSON.parse(await readFile(join(driftPath, name), 'utf8'))));
    const driftRecord = driftRecords.find(record => record.turn_hash === createHash('sha256').update('changed-model').digest('hex'));
    assert.equal(driftRecord.fallback_reason, 'changed-actual-model', 'A local turn cannot erase the last model used for drift detection');
    assert.equal(driftRecord.versions.jev_model, 'jev-fixture-changed');
    assert.deepEqual(driftRecord.provider_usage, { input_tokens: 170, output_tokens: 18 });
    globalThis.fetch = concurrentFetch;

    // Deliberate model selection must recover without losing same-alias drift protection.
    let selectedActual = 'jev-fixture-actual'; let selectionCalls = 0;
    globalThis.fetch = async () => {
      selectionCalls++;
      const response = goodResponse(); response.model = selectedActual;
      response.answers.continues_active_goal.noul = 0.99;
      return new Response(JSON.stringify(response));
    };
    const selectedInput = { ...input, session_id: 'model-selection' };
    const selectedPath = join(repositoryPath, createHash('sha256').update(selectedInput.session_id).digest('hex'));
    await handleCodexHook(selectedInput);
    const selectedConfig = { ...config, jev_model: 'jev-fixture-selected' };
    assert.equal((await configureJevModel(root, { apiKey: 'fixture-key', model: selectedConfig.jev_model,
      fetchImpl: async () => new Response(JSON.stringify({ models: [{ name: selectedConfig.jev_model,
        description: 'Selected fixture', release_date: '2026-09-15' }] })) })).status, 'ok');
    await handleCodexHook({ ...selectedInput, turn_id: 'selection-gap', prompt: 'hazlo' });
    await handleCodexHook({ ...selectedInput, turn_id: 'selection-recovery', prompt: 'Inspect `example.mjs`.' });
    assert.equal(selectionCalls, 1, 'A changed configuration cannot query across missing history');
    selectedActual = 'jev-fixture-selected-actual';
    for (const turn_id of ['selection-first', 'selection-second']) {
      assert.equal((await handleCodexHook({ ...selectedInput, turn_id })).stderr, '');
      const records = await Promise.all((await readdir(selectedPath)).filter(name => name.startsWith('decision-'))
        .map(async name => JSON.parse(await readFile(join(selectedPath, name), 'utf8'))));
      const decision = records.find(record => record.turn_hash === createHash('sha256').update(turn_id).digest('hex'));
      assert.equal(decision.fallback_reason, null, 'A deliberately selected alias must not retain the former actual model');
      assert.equal(decision.versions.jev_model, selectedActual);
    }
    await handleCodexHook({ ...selectedInput, turn_id: 'selection-local', prompt: 'hazlo' });
    selectedActual = 'jev-fixture-unselected-actual';
    await handleCodexHook({ ...selectedInput, turn_id: 'selection-drift' });
    const selectionRecords = await Promise.all((await readdir(selectedPath)).filter(name => name.startsWith('decision-'))
      .map(async name => JSON.parse(await readFile(join(selectedPath, name), 'utf8'))));
    assert.equal(selectionRecords.find(record => record.turn_hash === createHash('sha256').update('selection-drift').digest('hex')).fallback_reason,
      'changed-actual-model', 'Only explicit alias selection may reset the model expectation');
    selectedActual = 'jev-fixture-explicit-pin';
    for (const pinned of [true, false]) {
      const turn_id = pinned ? 'pin-set' : 'pin-removed';
      await writeFile(configPath, JSON.stringify({ ...selectedConfig, ...(pinned ? { jev_actual_model: selectedActual } : {}) }));
      await handleCodexHook({ ...selectedInput, turn_id: turn_id + '-gap', prompt: 'hazlo' });
      await handleCodexHook({ ...selectedInput, turn_id: turn_id + '-recovery', prompt: 'Inspect `example.mjs`.' });
      assert.equal((await handleCodexHook({ ...selectedInput, turn_id })).stderr, '');
      const records = await Promise.all((await readdir(selectedPath)).filter(name => name.startsWith('decision-'))
        .map(async name => JSON.parse(await readFile(join(selectedPath, name), 'utf8'))));
      const decision = records.find(record => record.turn_hash === createHash('sha256').update(turn_id).digest('hex'));
      assert.equal(decision.fallback_reason, null, 'Removing an admitted explicit pin must not resurrect its predecessor');
      assert.equal(decision.versions.jev_model, selectedActual);
    }
    await writeFile(configPath, JSON.stringify(config));
    globalThis.fetch = concurrentFetch;

    const beforeOffCalls = concurrentCalls;
    await handleCodexHook({ ...input, session_id: 'off-gap', prompt: 'Inspect `example.mjs`.' });
    await writeFile(configPath, JSON.stringify({ ...config, mode: 'off' }));
    await handleCodexHook({ ...input, session_id: 'off-gap', prompt: 'Review the changes.' });
    await writeFile(configPath, JSON.stringify(config));
    await handleCodexHook({ ...input, session_id: 'off-gap', prompt: 'hazlo' });
    const offGapPath = join(repositoryPath, createHash('sha256').update('off-gap').digest('hex'));
    const offGap = JSON.parse(await readFile(join(offGapPath, 'task.json'), 'utf8'));
    assert.equal(offGap.continuity, 'unknown', 'An identical restored configuration cannot certify continuity across an off interval');
    assert.equal(offGap.history_gap, true); assert.equal(concurrentCalls, beforeOffCalls);

    process.env.TYPESAFE_API_KEY = 'invalid\ncredential';
    assert.equal((await handleCodexHook({ ...input, session_id: 'credential-error' })).stderr, '');
    const failedCredentialPath = join(repositoryPath, createHash('sha256').update('credential-error').digest('hex'));
    const credentialRecords = (await readdir(failedCredentialPath)).filter(name => name.startsWith('decision-'));
    assert.equal(credentialRecords.length, 1, 'A credential failure must still record the captured local decision');
    const credentialRecord = JSON.parse(await readFile(join(failedCredentialPath, credentialRecords[0]), 'utf8'));
    assert.equal(credentialRecord.fallback_reason, 'credential-unavailable');
    assert.equal(credentialRecord.provider_attempts, 0);
    assert.equal(JSON.parse(await readFile(join(failedCredentialPath, 'task.json'), 'utf8')).history_gap, false);
    process.env.TYPESAFE_API_KEY = 'fixture-key';
    await chmod(configPath, 0o644);
    const beforeNonprivate = await readdir(repositoryPath);
    assert.equal((await handleCodexHook({ ...input, session_id: 'nonprivate-policy' })).stderr, '');
    assert.deepEqual(await readdir(repositoryPath), beforeNonprivate, 'A nonprivate operational policy must remain off');
    assert.equal(concurrentCalls, beforeOffCalls);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [name, value] of [['HOME', oldHome], ['TYPESAFE_API_KEY', oldKey]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

// Duplicate decisions must not double-count Jev, and a failed billable attempt is unknown rather than free.
test('jev_usage_counts_unique_attempts_and_preserves_unknown_billing', async () => {
  const first = { decision_id: 'decision-one', provider_attempts: 1, provider_usage: { input_tokens: 170, output_tokens: 18 },
    versions: { jev_model: 'jev-fixture-actual' } };
  const second = { decision_id: 'decision-two', provider_attempts: 1, provider_usage: { input_tokens: 20, output_tokens: 2 },
    versions: { jev_model: 'jev-fixture-other' } };
  const local = { decision_id: 'decision-local', provider_attempts: 0, provider_usage: null, versions: { jev_model: null } };
  assert.deepEqual(collectJevUsage([first, first, second, local]), { available: true, input_tokens: 190,
    output_tokens: 20, total_tokens: 210, requests: 2, models: ['jev-fixture-actual', 'jev-fixture-other'] });
  assert.equal(collectJevUsage([...[], first, { ...second, provider_usage: null }]).available, false);
  assert.equal(collectJevUsage([first, { ...first, provider_usage: { input_tokens: 200, output_tokens: 2 } }]).available, false);
  assert.equal(collectJevUsage([]).input_tokens, null);
  const path = join(temporaryRoot, 'private-decision-usage.jsonl');
  await writeFile(path, [first, first, second, local].map(record => JSON.stringify(record)).join('\n') + '\n', { mode: 0o600 });
  const cli = spawnSync(process.execPath, [resolve('src/pilot-evaluation.mjs'), 'jev-usage', '--decisions', path], { encoding: 'utf8' });
  assert.equal(cli.status, 0, 'The evaluator must expose Jev usage without exporting decision source');
  assert.equal(JSON.parse(cli.stdout).total_tokens, 210);
});

// A failed setup must release its own lock even when temporary creation or cleanup fails.
test('jev_model_setup_failures_release_the_owned_lock', async () => {
  const options = { apiKey: 'fixture-key', fetchImpl: async () => new Response(JSON.stringify({
    models: [{ name: 'jev-fixture-alias', description: 'Fixture', release_date: '2026-09-15' }] })) };
  const realOpen = contextFileSystem.open; const realUnlink = contextFileSystem.unlink;
  for (const failure of ['open', 'cleanup']) {
    const root = await mkdtemp(join(temporaryRoot, 'setup-failure-'));
    const opening = mock.method(contextFileSystem, 'open', async (path, ...args) => {
      if (path.includes('/.jev-setup-') && failure === 'open') throw Object.assign(new Error('Fixture open failure'), { code: 'EACCES' });
      const file = await realOpen(path, ...args);
      if (path.includes('/.jev-setup-')) file.sync = async () => { throw Object.assign(new Error('Fixture sync failure'), { code: 'EIO' }); };
      return file;
    });
    const removing = mock.method(contextFileSystem, 'unlink', async path => {
      if (path.includes('/.jev-setup-')) throw Object.assign(new Error('Fixture cleanup failure'), { code: 'EACCES' });
      return realUnlink(path);
    });
    syncBuiltinESMExports();
    try { await configureJevModel(root, options).catch(() => {}); }
    finally { opening.mock.restore(); removing.mock.restore(); syncBuiltinESMExports(); }
    assert.equal((await readdir(join(root, '.codex'))).includes('.jev-setup.lock'), false,
      'Failed ' + failure + ' must not leave future setup permanently busy');
    assert.equal((await configureJevModel(root, options)).status, 'ok');
  }
});
