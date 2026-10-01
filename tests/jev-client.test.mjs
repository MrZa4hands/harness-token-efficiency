import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, realpath, readdir, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { queryJevContext, minimizeJevState, discoverJevModels, configureJevModel } from '../src/jev-client.mjs';
import { resolveContextDecision } from '../src/context-state.mjs';
import { handleCodexHook } from '../src/codex-context-policy.mjs';
import { collectJevUsage } from '../src/pilot-evaluation.mjs';

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
  for (const text of ['Use github_pat_SYNTHETIC_PRIVATE_TOKEN_TO_REJECT', 'Authorization: Bearer synthetic-secret',
    'API_KEY=synthetic-secret', '```js\nexport const privateSource = 1;\n```', '-----BEGIN PRIVATE KEY-----',
    'Read https://user:password@example.invalid', 'export const privateSource = "hidden";', 'x'.repeat(2000)]) {
    assert.equal(minimizeJevState({ ...sourceState, recent_requests: [{ text }], active_request: { text } }, facts), null);
  }
  let calls = 0;
  const options = { apiKey: 'fixture-key', signal: AbortSignal.timeout(2000), fetchImpl: async () => { calls++; return new Response('{}'); } };
  const cases = [
    [{ ...request, state: { ...minimalState, request: 'github_pat_SYNTHETIC_PRIVATE_TOKEN' } }, options],
    [{ ...request, questions: { ...questions, extra: { type: 'noul', instructions: 'x'.repeat(6000) } } }, options],
    [request, { ...options, apiKey: null }],
    [request, { ...options, mode: 'off' }],
    [request, { ...options, jevEnabled: false }],
    [request, { ...options, conclusiveRule: true }],
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
});

// Setup must choose only authenticated returned names, never invent an available model from examples.
test('jev_model_discovery_uses_authenticated_setup_contract', async () => {
  let calls = 0;
  const discovered = await discoverJevModels({ apiKey: 'fixture-key', fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://api.typesafe.ai/v1/models'); assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer fixture-key'); assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify({ models: [{ name: 'jev-fixture-alias', description: 'Fixture only', release_date: '2026-09-15' }] }));
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
      response.answers.continues_active_goal.noul = 0.01;
      return new Response(JSON.stringify(response));
    };
    await handleCodexHook({ ...input, turn_id: 'new-objective', prompt: 'What happens if the input is empty?' });
    const privateState = JSON.parse(await readFile(join(sessionPath, 'task.json'), 'utf8'));
    assert.equal(privateState.active_request.text, 'What happens if the input is empty?',
      'A validated negative continuity observation must preserve the new explicit objective for the next turn');
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
