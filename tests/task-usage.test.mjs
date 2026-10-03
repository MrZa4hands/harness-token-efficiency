import test from 'node:test';
import assert from 'node:assert/strict';
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
  const decisions = [{ source_sha256: decisionHash, records: [{ decision_id: 'provider', session_id: 'root', turn_id: 'turn',
    provider_attempts: 1, provider_usage: { input_tokens: 7, output_tokens: 3 }, versions: { jev_model: 'fixture-model' }, applied: false }] }];
  return { manifest, captures: [parent, child], decisions };
}
const collect = ({ manifest, captures, decisions }) => collectCompleteTaskUsage(manifest, captures, decisions);

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
    v => v.decisions[0].records[0].session_id = 'foreign', v => v.decisions[0].source_sha256 = 'e'.repeat(64)]) {
    const value = inputs(); mutate(value); const result = collect(value);
    assert.equal(result.known_lower_bound.jev_total_tokens, null); assert.equal(result.jev_usage.available, false);
    assert.equal(result.known_lower_bound.codex_total_tokens, 140);
  }
});
