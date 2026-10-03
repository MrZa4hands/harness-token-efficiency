import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { collectCompleteTaskUsage } from '../src/task-usage.mjs';

const usage = (input, output) => ({ input_tokens: input, cached_input_tokens: 0, cache_write_input_tokens: 0,
  output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output });
const rootHash = 'a'.repeat(64), childHash = 'b'.repeat(64), decisionHash = 'c'.repeat(64);
function inputs() {
  const parent = { available: true, source_sha256: rootHash, client_version: '0.159.2', thread_id: 'root',
    root_session_id: 'root', root_turn_id: 'task', main_model: 'model', reasoning_effort: 'high', parent_thread_id: null,
    responses: [{ response_id: 'new', turn_id: 'turn', root_turn_id: 'task', usage: usage(80, 20), thread_usage: usage(180, 40) }],
    all_responses: [{ response_id: 'old', usage: usage(100, 20), thread_usage: usage(100, 20) }],
    task_records: [{ type: 'task_started', record_index: 3, turn_id: 'turn' }, { type: 'task_complete', record_index: 9, turn_id: 'turn' }],
    worker_coverage_verified: false, provider_coverage_verified: false };
  parent.all_responses.push(parent.responses[0]);
  const child = { ...parent, source_sha256: childHash, thread_id: 'child', parent_thread_id: 'root',
    responses: [{ response_id: 'worker-response', turn_id: 'worker-turn', root_turn_id: 'task', usage: usage(30, 10), thread_usage: usage(30, 10) }],
    task_records: [{ type: 'task_started', record_index: 2, turn_id: 'worker-turn' }, { type: 'task_complete', record_index: 6, turn_id: 'worker-turn' }] };
  child.all_responses = child.responses;
  const manifest = { manifest_version: 1, task_id: 'fixture-task', run_id: 'fixture-run', client_version: '0.159.2',
    main_model: 'model', reasoning_effort: 'high', root_session_id: 'root', root_turn_id: 'task',
    captures: [{ path: 'root.jsonl', sha256: rootHash, thread_id: 'root' }, { path: 'child.jsonl', sha256: childHash, thread_id: 'child' }],
    intervals: [{ thread_id: 'root', start_response_id: 'old', end_response_id: 'new', initial_usage: usage(100, 20),
      final_usage: usage(180, 40), response_ids: ['new'] }, { thread_id: 'child', start_response_id: null,
      end_response_id: 'worker-response', initial_usage: usage(0, 0), final_usage: usage(30, 10), response_ids: ['worker-response'] }],
    decisions: [{ path: 'decisions.jsonl', sha256: decisionHash }],
    closure: { worker_source_refs: [], provider_source_refs: [] } };
  const decisions = [{ path: 'decisions.jsonl', source_sha256: decisionHash, records: [{ decision_id: 'provider', session_id: 'root', turn_id: 'turn',
    provider_attempts: 1, provider_usage: { input_tokens: 7, output_tokens: 3 }, versions: { jev_model: 'fixture-model' }, applied: false }] }];
  return { manifest, captures: [parent, child], decisions };
}
const collect = ({ manifest, captures, decisions }) => collectCompleteTaskUsage(manifest, captures, decisions);

// Conflicting worker copies cannot erase an independently verified root interval or provider decision.
test('task_usage_excludes_conflicting_workers_without_erasing_independent_bounds', () => {
  const value = inputs(); const conflict = structuredClone(value.captures[1]);
  conflict.source_sha256 = 'e'.repeat(64); value.captures.push(conflict);
  value.manifest.captures.push({ path: 'worker-copy', thread_id: 'child', sha256: conflict.source_sha256 });
  for (const captures of [value.captures, [...value.captures].reverse()]) {
    const result = collect({ ...value, captures });
    assert.deepEqual(result.known_lower_bound, { codex_total_tokens: 100, jev_total_tokens: 10 });
    assert.equal(result.task_coverage_verified, false);
    assert.ok(result.limitations.some(message => message.includes('Conflicting task capture')));
  }
});

// Reused decision snapshots are admitted once, without descriptor-times-record amplification.
test('task_usage_admits_repeated_decision_sources_once_and_handles_large_record_arrays', () => {
  const value = inputs(); const hash = id => createHash('sha256').update(id).digest('hex');
  const sessionHash = hash('root'), turnHash = hash('turn'); let visits = 0;
  value.decisions[0].records = Array.from({ length: 1000 }, (_, index) => ({ decision_id: 'decision-' + index,
    get session_hash() { visits++; return sessionHash; }, turn_hash: turnHash, provider_attempts: 1,
    provider_usage: { input_tokens: 7, output_tokens: 3 }, versions: { jev_model: 'fixture-model' } }));
  value.manifest.decisions = Array.from({ length: 128 }, () => ({ ...value.manifest.decisions[0] }));
  const result = collect(value);
  assert.deepEqual(result.known_lower_bound, { codex_total_tokens: 140, jev_total_tokens: 10_000 });
  assert.ok(visits <= 3000, 'Repeated sources must not multiply row admission: ' + visits);
  value.manifest.decisions[127].sha256 = 'e'.repeat(64);
  const mismatched = collect(value);
  assert.equal(mismatched.observed_providers.jev.available, false);
  assert.equal(mismatched.known_lower_bound.jev_total_tokens, 10_000, 'Each descriptor still binds its own hash');
  // The pure accounting boundary must not place a 100k-row array on the V8 argument stack.
  value.manifest.decisions = [value.manifest.decisions[0]];
  value.decisions[0].records = Array.from({ length: 100_000 }, (_, index) => ({ decision_id: 'large-' + index,
    session_id: 'root', turn_id: 'turn', provider_attempts: 1,
    provider_usage: { input_tokens: 7, output_tokens: 3 }, versions: { jev_model: 'fixture-model' } }));
  assert.deepEqual(collect(value).known_lower_bound, { codex_total_tokens: 140, jev_total_tokens: 1_000_000 });
});

// A malformed worker must not erase the independently bound root and provider contributions.
test('task_usage_preserves_independent_bounds_beside_malformed_capture', () => {
  for (const mutate of [row => delete row.root_turn_id, row => row.root_turn_ids = [],
    row => row.responses = {}, row => row.all_responses = {}, row => row.responses = [null]]) {
    const value = inputs(); mutate(value.captures[1]);
    const result = collect(value);
    assert.deepEqual(result.known_lower_bound, { codex_total_tokens: 100, jev_total_tokens: 10 });
    assert.equal(result.codex_usage.total_tokens, null);
  }
});

// Partial bounds must identify admitted root turns without an accepted root interval, without exposing IDs.
test('task_usage_reports_missing_admitted_root_turn_coverage', () => {
  const value = inputs(); delete value.manifest.root_turn_id;
  value.manifest.root_turn_ids = ['task', 'PRIVATE_MISSING_ROOT_TURN'];
  value.manifest.intervals[0].turn_id = 'turn'; value.manifest.intervals[1].turn_id = 'worker-turn';
  const result = collect(value);
  assert.equal(result.known_lower_bound.codex_total_tokens, 140);
  assert.ok(result.limitations.some(message => message.includes('Admitted root turns without verified intervals: 1')));
  assert.ok(!JSON.stringify(result).includes('PRIVATE_MISSING_ROOT_TURN'));
});

// Invalid short membership cannot repeatedly scan a much larger source interval.
test('task_usage_rejects_mismatched_interval_lengths_before_visiting_source_span', () => {
  const value = inputs(); let visits = 0;
  for (let index = 0; index < 1000; index++) {
    value.captures[0].all_responses.push({ get response_id() { visits++; return 'extra-' + index; } });
  }
  const invalid = { ...value.manifest.intervals[0], end_response_id: 'extra-999', response_ids: ['missing'] };
  value.manifest.intervals = [...Array.from({ length: 100 }, () => structuredClone(invalid)), ...value.manifest.intervals];
  assert.equal(collect(value).known_lower_bound.codex_total_tokens, 140);
  assert.ok(visits <= 3000, 'Rejected intervals must not multiply source-sized work: ' + visits);
});

// Corrections and a reused worker contribute once, while the resumed prefix stays outside the task.
test('task_usage_accounts_two_turns_with_reused_worker', () => {
  const value = inputs();
  delete value.manifest.root_turn_id;
  value.manifest.root_turn_ids = ['task', 'correction'];
  for (const capture of value.captures) {
    delete capture.root_turn_id; capture.root_turn_ids = ['task', 'correction'];
    const previous = capture.responses[0];
    const next = { response_id: capture.thread_id + '-correction', turn_id: capture.thread_id + '-follow-up',
      root_turn_id: 'correction', usage: usage(5, 2),
      thread_usage: usage(previous.thread_usage.input_tokens + 5, previous.thread_usage.output_tokens + 2) };
    capture.responses.push(next); capture.all_responses = [...capture.all_responses.filter(row => row !== next), next];
    const first = value.manifest.intervals.find(row => row.thread_id === capture.thread_id);
    first.turn_id = previous.turn_id;
    value.manifest.intervals.push({ thread_id: capture.thread_id, turn_id: next.turn_id,
      start_response_id: previous.response_id, end_response_id: next.response_id, initial_usage: previous.thread_usage,
      final_usage: next.thread_usage, response_ids: [next.response_id] });
  }
  value.manifest.intervals.push(structuredClone(value.manifest.intervals[2]));
  const result = collect(value);
  assert.equal(result.known_lower_bound.codex_total_tokens, 154);
  assert.equal(result.task_coverage_verified, false); assert.equal(result.codex_usage.total_tokens, null);
  const missing = structuredClone(value); missing.manifest.root_turn_ids = ['task'];
  assert.equal(collect(missing).known_lower_bound.codex_total_tokens, 140);
  for (const turns of [[], ['task', 'task']]) {
    const invalid = structuredClone(value); invalid.manifest.root_turn_ids = turns;
    assert.equal(collect(invalid).known_lower_bound.codex_total_tokens, null);
  }
  const foreign = structuredClone(value); foreign.manifest.intervals[2].turn_id = 'unbound';
  foreign.manifest.intervals.pop();
  assert.equal(collect(foreign).known_lower_bound.codex_total_tokens, 147);
});

// Native immutable decisions use identity hashes, including rejected billed queries.
test('task_usage_admits_native_hashed_decisions_without_rewriting_sources', () => {
  const value = inputs(); const row = value.decisions[0].records[0];
  const hash = id => createHash('sha256').update(id).digest('hex');
  delete row.session_id; delete row.turn_id;
  row.session_hash = hash('root'); row.turn_hash = hash('turn');
  assert.equal(collect(value).known_lower_bound.jev_total_tokens, 10);
  row.turn_hash = hash('outside');
  assert.equal(collect(value).known_lower_bound.jev_total_tokens, null);
  row.turn_hash = hash('turn'); row.session_id = 'outside';
  assert.equal(collect(value).known_lower_bound.jev_total_tokens, null);
  row.session_id = 'root'; row.turn_id = 'worker-turn';
  assert.equal(collect(value).known_lower_bound.jev_total_tokens, null, 'Raw and hashed identities must name the same admitted turn');
});

// Prior unrelated consumption and duplicate snapshots must not inflate admitted interval usage.
test('task_usage_counts_interval_and_worker_once', () => {
  const value = inputs(); value.captures.push(structuredClone(value.captures[0]));
  const result = collect(value);
  assert.equal(result.known_lower_bound.codex_total_tokens, 140);
  assert.equal(result.task_coverage_verified, false);
  assert.equal(result.codex_usage.total_tokens, null, 'Observed adapter cannot certify exhaustive closure');
  assert.equal(result.measurement_scope, 'task'); assert.equal(result.cost, null);
  assert.ok(!JSON.stringify(result).includes('worker-response'));
});

// A rejected query still consumes provider tokens; cached and reasoning counters are already subsets.
test('task_usage_includes_rejected_provider_attempts', () => {
  const value = inputs(); value.decisions[0].records.push(structuredClone(value.decisions[0].records[0]));
  const result = collect(value);
  assert.equal(result.known_lower_bound.jev_total_tokens, 10);
  assert.equal(result.observed_providers.jev.requests, 1);
  assert.equal(result.providers.jev.total_tokens, null);
});

// Missing workers, supplied completeness flags, and source references cannot manufacture native proof.
test('task_usage_preserves_unknown_closure_and_partial_lower_bounds', () => {
  for (const mutate of [v => v.captures.pop(), v => v.manifest.closure.complete = true,
    v => v.manifest.closure.worker_source_refs.push({ capture_sha256: rootHash, record_index: 9 }),
    v => v.decisions.splice(0), v => v.manifest.captures.push({ path: 'grandchild.jsonl', sha256: 'd'.repeat(64), thread_id: 'grandchild' })]) {
    const value = inputs(); mutate(value); const result = collect(value);
    assert.equal(result.task_coverage_verified, false); assert.equal(result.codex_usage.available, false);
    assert.equal(result.codex_usage.total_tokens, null); assert.equal(result.jev_usage.total_tokens, null);
  }
});

// Conflicting intervals, identities and counters cannot acquire a verified arithmetic lower bound.
test('task_usage_rejects_inconsistent_boundaries_and_identity', () => {
  for (const mutate of [v => v.manifest.intervals[0].initial_usage = usage(0, 0),
    v => v.manifest.intervals[0].response_ids.push('new'), v => v.manifest.intervals[0].end_response_id = 'missing',
    v => v.captures[0].responses[0].usage = usage(79, 20), v => v.captures[0].root_session_id = 'foreign',
    v => v.captures[0].main_model = 'other', v => v.manifest.captures[0].sha256 = 'e'.repeat(64),
    v => v.captures[0].responses[0].usage.input_tokens = Number.MAX_SAFE_INTEGER + 1]) {
    const value = inputs(); mutate(value); const result = collect(value);
    assert.equal(result.task_coverage_verified, false);
    assert.ok(result.known_lower_bound.codex_total_tokens === null || result.known_lower_bound.codex_total_tokens <= 40);
  }
});

// Unknown billing and conflicting copies must not become zero-cost classification.
test('task_usage_rejects_conflicting_or_missing_provider_usage', () => {
  for (const mutate of [v => v.decisions[0].records[0].provider_usage = null,
    v => v.decisions[0].records.push({ ...v.decisions[0].records[0], provider_usage: { input_tokens: 8, output_tokens: 3 } }),
    v => v.decisions[0].records[0].session_id = 'foreign', v => v.decisions[0].source_sha256 = 'e'.repeat(64),
    v => v.decisions[0].path = 'foreign.jsonl']) {
    const value = inputs(); mutate(value); const result = collect(value);
    assert.equal(result.known_lower_bound.jev_total_tokens, null); assert.equal(result.jev_usage.available, false);
    assert.equal(result.known_lower_bound.codex_total_tokens, 140);
  }
});

// A distinct abandoned query cannot erase independently verified consumption.
test('task_usage_retains_known_billing_beside_unknown_attempts', () => {
  const value = inputs();
  value.decisions[0].records.push({ ...value.decisions[0].records[0], decision_id: 'abandoned', provider_usage: null });
  const result = collect(value);
  assert.equal(result.observed_providers.jev.available, false);
  assert.equal(result.known_lower_bound.jev_total_tokens, 10);
  value.decisions[0].records.push({ ...value.decisions[0].records[0], provider_usage: { input_tokens: 8, output_tokens: 3 } });
  assert.equal(collect(value).known_lower_bound.jev_total_tokens, null, 'Conflicting copies exclude that entire decision identity');
});
