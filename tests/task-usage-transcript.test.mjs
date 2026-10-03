import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readTaskUsageTranscript, readPrivateTaskSnapshot } from '../src/task-usage-transcript.mjs';

const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'task-transcript-')));
after(() => assert.equal(spawnSync('trash', [root]).status, 0));
const options = { client_version: '0.159.2', thread_id: 'worker', root_session_id: 'root', root_turn_id: 'task-turn' };
const usage = (input, output) => ({ input_tokens: input, cached_input_tokens: 0, cache_write_input_tokens: 0,
  output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output });
const rows = () => [
  { type: 'session_meta', payload: { id: 'worker', session_id: 'root', parent_thread_id: 'root', cli_version: '0.159.2',
    agent_path: '/root/child', subagent_history_start_ordinal: 4 } },
  { type: 'session_meta', payload: { id: 'root', session_id: 'root', cli_version: '0.159.2' } },
  { type: 'token_usage_record', payload: { thread_id: 'root', session_id: 'root', root_turn_id: 'task-turn',
    turn_id: 'parent-turn', response_id: 'parent-response', usage: usage(100, 20), thread_token_usage: usage(100, 20) } },
  { type: 'turn_context', payload: { turn_id: 'child-turn', root_turn_id: 'task-turn', model: 'fixture-model', effort: 'high' } },
  { type: 'event_msg', payload: { type: 'task_started', turn_id: 'child-turn', root_turn_id: 'task-turn' } },
  { type: 'token_usage_record', payload: { thread_id: 'worker', session_id: 'root', root_turn_id: 'task-turn',
    turn_id: 'child-turn', response_id: 'child-response', usage: usage(30, 10), thread_token_usage: usage(30, 10) } },
  { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'child-turn', completed_at: '2026-10-03T10:00:00Z' } },
  { type: 'response_item', payload: { type: 'message', content: 'PRIVATE_TRANSCRIPT_VALUE' } },
];
async function capture(name, records) {
  const path = join(root, name); await fs.writeFile(path, records.map(JSON.stringify).join('\n') + '\n', { mode: 0o600 }); return path;
}

// A reused worker can bill follow-up corrections under a second admitted root turn.
test('task_transcript_binds_multiple_task_turns_without_prior_history', async () => {
  const records = rows();
  records.push({ type: 'turn_context', payload: { turn_id: 'correction', root_turn_id: 'follow-up', model: 'fixture-model', effort: 'high' } },
    { type: 'token_usage_record', payload: { thread_id: 'worker', session_id: 'root', root_turn_id: 'follow-up',
      turn_id: 'correction', response_id: 'correction-response', usage: usage(5, 2), thread_token_usage: usage(35, 12) } });
  const path = await capture('multi-turn.jsonl', records);
  const { root_turn_id, ...identities } = options;
  const result = await readTaskUsageTranscript(path, { ...identities, root_turn_ids: ['task-turn', 'follow-up'] });
  assert.equal(result.available, true);
  assert.deepEqual(result.responses.map(row => row.response_id), ['child-response', 'correction-response']);
  assert.equal(result.final_usage.total_tokens, 47);
  for (const turns of [[], ['task-turn', 'task-turn']]) {
    assert.equal((await readTaskUsageTranscript(path, { ...identities, root_turn_ids: turns })).available, false);
  }
});

// A worker participating only in the first turn retains its verified contribution during a root follow-up.
test('task_transcript_retains_worker_bound_when_other_task_turns_are_absent_from_its_capture', async () => {
  const { root_turn_id, ...identities } = options;
  const result = await readTaskUsageTranscript(await capture('single-worker-turn.jsonl', rows()),
    { ...identities, root_turn_ids: ['task-turn', 'root-follow-up'] });
  assert.equal(result.available, true); assert.equal(result.final_usage.total_tokens, 40);
  assert.deepEqual(result.root_turn_ids, ['task-turn']);
  assert.deepEqual(result.missing_root_turn_ids, ['root-follow-up']);
  assert.equal(result.worker_coverage_verified, false);
});

// Counting inherited parent responses would inflate the worker lower bound.
test('task_transcript_excludes_inherited_parent_responses', async () => {
  const result = await readTaskUsageTranscript(await capture('worker.jsonl', rows()), options);
  assert.equal(result.available, true);
  assert.deepEqual(result.responses.map(row => row.response_id), ['child-response']);
  assert.equal(result.final_usage.total_tokens, 40); assert.equal(result.initial_usage.total_tokens, 0);
  assert.equal(result.worker_coverage_verified, false);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_TRANSCRIPT_VALUE'));
});

// A subject identity without matching native metadata must not acquire counters.
test('task_transcript_rejects_unverified_subject', async () => {
  const path = await capture('identity.jsonl', rows());
  for (const changed of [{ thread_id: 'foreign' }, { root_session_id: 'foreign' }, { root_turn_id: 'foreign' },
    { client_version: 'new-version' }, { thread_id: null }]) {
    const result = await readTaskUsageTranscript(path, { ...options, ...changed });
    assert.equal(result.available, false); assert.equal(result.final_usage, null);
  }
});

// Duplicate response snapshots count once; contradictory snapshots cannot certify arithmetic.
test('task_transcript_deduplicates_exact_responses_and_rejects_corruption', async () => {
  const original = rows();
  assert.equal((await readTaskUsageTranscript(await capture('duplicate.jsonl',
    [...original.slice(0, 6), original[5], ...original.slice(6)]), options)).responses.length, 1);
  for (const change of ['conflict', 'reset', 'overflow', 'missing', 'model', 'effort']) {
    const changed = rows();
    if (change === 'missing') delete changed[5].payload.usage;
    else if (change === 'overflow') changed[5].payload.usage.input_tokens = Number.MAX_SAFE_INTEGER + 1;
    else if (change === 'conflict') changed.splice(6, 0, { ...changed[5], payload: { ...changed[5].payload, usage: usage(31, 10) } });
    else if (change === 'reset') changed.splice(6, 0, { ...changed[5], payload: { ...changed[5].payload,
      response_id: 'next', usage: usage(1, 1), thread_token_usage: usage(1, 1) } });
    else changed.splice(5, 0, { type: 'turn_context', payload: { ...changed[3].payload,
      ...(change === 'model' ? { model: 'other' } : { effort: 'low' }) } });
    assert.equal((await readTaskUsageTranscript(await capture(change + '.jsonl', changed), options)).available, false, change);
  }
  const bad = join(root, 'bad.jsonl'); await fs.writeFile(bad, '{"type":"PRIVATE_TRANSCRIPT_VALUE"}\n{broken\n{}\n', { mode: 0o600 });
  const result = await readTaskUsageTranscript(bad, options);
  assert.equal(result.available, false); assert.ok(!JSON.stringify(result).includes('PRIVATE_TRANSCRIPT_VALUE'));
});

// Snapshot reads must never follow symlinks, block on FIFO, or accept growing sources.
test('task_transcript_rejects_nonprivate_nonregular_and_changed_snapshots', async () => {
  const path = await capture('boundaries.jsonl', rows()); const link = join(root, 'link'); await fs.symlink(path, link);
  assert.equal((await readTaskUsageTranscript(link, options)).available, false);
  const fifo = join(root, 'fifo'); assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
  assert.equal((await readTaskUsageTranscript(fifo, options)).available, false);
  await fs.chmod(path, 0o644); assert.equal((await readTaskUsageTranscript(path, options)).available, false); await fs.chmod(path, 0o600);
  const huge = join(root, 'oversized'); const handle = await fs.open(huge, 'w', 0o600); await handle.truncate(64_000_001); await handle.close();
  assert.equal((await readTaskUsageTranscript(huge, options)).available, false);
  const original = fs.open;
  const mocked = mock.method(fs, 'open', async (...args) => {
    const file = await original(...args); const read = file.read.bind(file); let changed = false;
    file.read = async (...readArgs) => {
      const result = await read(...readArgs); if (!changed) { changed = true; await fs.appendFile(path, '{}\n'); } return result;
    }; return file;
  });
  try { assert.equal((await readTaskUsageTranscript(path, options)).available, false); }
  finally { mocked.mock.restore(); }
});

// The versioned sample exercises the same adapter as real captures.
test('task_transcript_versioned_fixture_is_native_shaped', async () => {
  const path = join(root, 'fixture.jsonl'); await fs.writeFile(path,
    await fs.readFile(resolve('evaluation/fixtures/task-usage-01592.jsonl')), { mode: 0o600 });
  assert.equal((await readTaskUsageTranscript(path, options)).final_usage.total_tokens, 40);
});

// Final-component O_NOFOLLOW alone does not protect a concurrently replaced ancestor.
test('task_snapshot_rejects_ancestor_replacement_during_open', async () => {
  const dir = join(root, 'ancestor'); const outside = join(root, 'outside');
  await fs.mkdir(dir, { mode: 0o700 }); await fs.mkdir(outside, { mode: 0o700 });
  const path = join(dir, 'capture'); await fs.writeFile(path, 'inside', { mode: 0o600 });
  await fs.writeFile(join(outside, 'capture'), 'outside', { mode: 0o600 });
  const original = fs.open; let changed = false;
  const mocked = mock.method(fs, 'open', async (...args) => {
    if (args[0] === path && !changed) {
      changed = true; await fs.rename(dir, dir + '-saved'); await fs.symlink(outside, dir);
    }
    return original(...args);
  });
  try { await assert.rejects(readPrivateTaskSnapshot(path), /snapshot rejected/); }
  finally { mocked.mock.restore(); }
});

// Byte limits alone allow a huge decoded line or unbounded duplicate records.
test('task_transcript_caps_line_bytes_and_parsed_records_before_deduplication', async () => {
  const base = rows().map(JSON.stringify).join('\n') + '\n';
  const admitted = [];
  for (const count of [100_000, 100_001]) {
    const path = join(root, 'records-' + count);
    await fs.writeFile(path, base + '{}\n'.repeat(count - rows().length), { mode: 0o600 });
    admitted.push((await readTaskUsageTranscript(path, options)).available);
  }
  const duplicate = JSON.stringify(rows()[5]) + '\n';
  const flood = join(root, 'duplicate-flood');
  await fs.writeFile(flood, base + duplicate.repeat(100_001 - rows().length), { mode: 0o600 });
  admitted.push((await readTaskUsageTranscript(flood, options)).available);
  for (const size of [1_000_000, 1_000_001]) {
    const prefix = '{"type":"response_item","payload":"'; const suffix = '"}\n';
    const path = join(root, 'line-' + size);
    await fs.writeFile(path, base + prefix + 'x'.repeat(size - prefix.length - suffix.length) + suffix, { mode: 0o600 });
    admitted.push((await readTaskUsageTranscript(path, options)).available);
  }
  assert.deepEqual(admitted, [true, false, false, true, false]);
});

// Path replacement must not make validation and parsing operate on different files.
test('task_transcript_reads_checked_descriptor_and_closes_on_stream_failures', async () => {
  const original = fs.open;
  for (const change of ['replace', 'rewrite', 'truncate', 'read-error']) {
    const path = await capture('descriptor-' + change, rows()); let closed = false; let changed = false;
    const mocked = mock.method(fs, 'open', async (...args) => {
      const file = await original(...args); const read = file.read.bind(file); const close = file.close.bind(file);
      file.close = async () => { closed = true; return close(); };
      file.read = async (...readArgs) => {
        if (!changed) {
          changed = true;
          if (change === 'replace') {
            await fs.rename(path, path + '-checked'); await fs.writeFile(path, 'PRIVATE_REPLACEMENT\n', { mode: 0o600 });
          } else if (change === 'rewrite') await fs.writeFile(path, 'x'.repeat((await file.stat()).size));
          else if (change === 'truncate') await fs.truncate(path, 1);
          else throw new Error('PRIVATE_STREAM_ERROR');
        }
        return read(...readArgs);
      }; return file;
    });
    try {
      const result = await readTaskUsageTranscript(path, options);
      if (change !== 'replace') assert.equal(result.available, false);
      else if (result.available) assert.equal(result.final_usage.total_tokens, 40);
      assert.equal(closed, true);
      assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
    } finally { mocked.mock.restore(); }
  }
});
