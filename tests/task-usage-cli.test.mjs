import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadPrivateTaskMeasurement } from '../scripts/measure-task-usage.mjs';
import { readTaskUsageTranscript, resolvePrivateTaskReference } from '../src/task-usage-transcript.mjs';

const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'task-usage-cli-')));
after(() => assert.equal(spawnSync('trash', [root]).status, 0));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const zero = { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0,
  reasoning_output_tokens: 0, total_tokens: 0 };
const invoke = (path, args = []) => spawnSync(process.execPath, [resolve('scripts/measure-task-usage.mjs'), '--manifest', path, ...args],
  { encoding: 'utf8', timeout: 10000 });
async function fixture(name) {
  const dir = join(root, name); await fs.mkdir(dir, { mode: 0o700 });
  const data = await fs.readFile('evaluation/fixtures/task-usage-01592.jsonl');
  await fs.writeFile(join(dir, 'worker.jsonl'), data, { mode: 0o600 });
  const manifest = { manifest_version: 1, task_id: 'synthetic', run_id: 'synthetic-run', client_version: '0.159.2',
    main_model: 'fixture-model', reasoning_effort: 'high', root_session_id: 'root', root_turn_id: 'task-turn',
    captures: [{ path: 'worker.jsonl', thread_id: 'worker', sha256: sha(data) }], intervals: [{ thread_id: 'worker',
      start_response_id: null, end_response_id: 'child-response', response_ids: ['child-response'], initial_usage: zero,
      final_usage: { ...zero, input_tokens: 30, output_tokens: 10, total_tokens: 40 } }], decisions: [],
    closure: { worker_source_refs: [], provider_source_refs: [] } };
  const path = join(dir, 'task.json'); await fs.writeFile(path, JSON.stringify(manifest), { mode: 0o600 });
  return { dir, path, manifest };
}

// Native-unsupported closure returns partial JSON with a nonzero exit; missing sources stay unknown.
test('task_usage_cli_retains_unknown_complete_coverage_without_mutation', async () => {
  const { path, dir } = await fixture('partial'); const before = await fs.readFile(path);
  const result = invoke(path); assert.equal(result.status, 1); const output = JSON.parse(result.stdout);
  assert.equal(output.task_coverage_verified, false); assert.equal(output.codex_usage.total_tokens, null);
  assert.equal(output.jev_usage.total_tokens, null); assert.equal(output.cost, null);
  assert.deepEqual(await fs.readFile(path), before);
  for (const sentinel of ['child-response', 'task-turn', 'synthetic-run', 'worker.jsonl', 'PRIVATE_TRANSCRIPT_VALUE']) {
    assert.ok(!(result.stdout + result.stderr).includes(sentinel));
  }
  assert.deepEqual((await fs.readdir(dir)).sort(), ['task.json', 'worker.jsonl']);
});

// Paths and source hashes cannot admit public, outside, blocking or unbounded captures.
test('task_usage_cli_rejects_private_boundary_violations', async () => {
  const cases = ['unknown-argument', 'bad-hash', 'outside', 'symlink', 'fifo', 'nonprivate', 'large-manifest',
    'large-decisions', 'capture-count', 'aggregate-limit', 'subdirectory-symlink'];
  for (const name of cases) {
    const { path, dir, manifest } = await fixture(name); let extra = [];
    if (name === 'unknown-argument') extra = ['--PRIVATE_TRANSCRIPT_VALUE', 'secret'];
    if (name === 'bad-hash') manifest.captures[0].sha256 = 'f'.repeat(64);
    if (name === 'outside') manifest.captures[0].path = '../partial/worker.jsonl';
    if (name === 'symlink') { await fs.rename(join(dir, 'worker.jsonl'), join(dir, 'target')); await fs.symlink(join(dir, 'target'), join(dir, 'worker.jsonl')); }
    if (name === 'subdirectory-symlink') { await fs.symlink(dir, join(dir, 'sub')); manifest.captures[0].path = 'sub/worker.jsonl'; }
    if (name === 'fifo') { await fs.rename(join(dir, 'worker.jsonl'), join(dir, 'saved')); assert.equal(spawnSync('mkfifo', [join(dir, 'worker.jsonl')]).status, 0); }
    if (name === 'nonprivate') await fs.chmod(join(dir, 'worker.jsonl'), 0o644);
    if (name === 'large-decisions') { const file = await fs.open(join(dir, 'decisions.jsonl'), 'w', 0o600); await file.truncate(4_000_001); await file.close();
      manifest.decisions.push({ path: 'decisions.jsonl', sha256: 'a'.repeat(64) }); }
    if (name === 'capture-count') manifest.captures = Array.from({ length: 129 }, () => manifest.captures[0]);
    if (name === 'aggregate-limit') { const file = await fs.open(join(dir, 'worker.jsonl'), 'w', 0o600); await file.truncate(64_000_000); await file.close();
      manifest.captures = Array.from({ length: 9 }, () => manifest.captures[0]); }
    await fs.writeFile(path, JSON.stringify(manifest));
    if (name === 'large-manifest') { const file = await fs.open(path, 'r+'); await file.truncate(4_000_001); await file.close(); }
    const result = invoke(path, extra); assert.equal(result.status, 1, name);
    assert.equal(JSON.parse(result.stdout).task_coverage_verified, false, name);
    assert.ok(!(result.stdout + result.stderr).includes('PRIVATE_TRANSCRIPT_VALUE'), name);
  }
});

// Changing capture sizes after pathname preflight cannot bypass the descriptor byte budget.
test('task_usage_enforces_actual_snapshot_byte_budget', async () => {
  const { path, manifest, dir } = await fixture('actual-budget');
  manifest.captures.push(structuredClone(manifest.captures[0]));
  await fs.writeFile(path, JSON.stringify(manifest));
  const size = (await fs.stat(join(dir, 'worker.jsonl'))).size;
  const original = fs.lstat;
  const mocked = mock.method(fs, 'lstat', async (...args) => {
    const stat = await original(...args); if (args[0] === join(dir, 'worker.jsonl')) stat.size = 0; return stat;
  });
  try { await assert.rejects(loadPrivateTaskMeasurement(path, size + 1), /budget/); }
  finally { mocked.mock.restore(); }
});

async function rootFixture(name) {
  const { path, manifest, dir } = await fixture(name);
  const rows = (await fs.readFile(join(dir, 'worker.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    .filter(row => row.type !== 'token_usage_record' || row.payload.thread_id === 'worker');
  for (const row of rows) {
    if (row.type === 'session_meta' && row.payload.id === 'worker') { row.payload.id = 'root'; delete row.payload.parent_thread_id; }
    if (row.type === 'token_usage_record' && row.payload.thread_id === 'worker') row.payload.thread_id = 'root';
  }
  // Retain only the subject header/counter plus its own turn and task events.
  const data = rows.filter(row => row.type !== 'session_meta' || row.payload.agent_path).map(JSON.stringify).join('\n') + '\n';
  await fs.writeFile(join(dir, 'root.jsonl'), data, { mode: 0o600 });
  assert.equal((await readTaskUsageTranscript(join(dir, 'root.jsonl'), { client_version: '0.159.2', thread_id: 'root',
    root_session_id: 'root', root_turn_id: 'task-turn' })).available, true);
  manifest.captures = [{ path: 'root.jsonl', thread_id: 'root', sha256: sha(data) }];
  manifest.intervals[0].thread_id = 'root';
  return { path, manifest, dir };
}

// Stable malformed worker data remains unknown without deleting a verified root interval.
test('task_usage_cli_preserves_root_lower_bound_with_truncated_worker', async () => {
  const { path, manifest, dir } = await rootFixture('partial-capture');
  const broken = '{"type":'; await fs.writeFile(join(dir, 'worker.jsonl'), broken);
  manifest.captures.push({ path: 'worker.jsonl', thread_id: 'worker', sha256: sha(broken) });
  await fs.writeFile(path, JSON.stringify(manifest));
  const result = invoke(path); assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).known_lower_bound.codex_total_tokens, 40);
});

// Crash-truncated audits and absent sources cannot invalidate other authenticated snapshots.
test('task_usage_cli_preserves_independent_usage_when_audit_or_worker_missing', async () => {
  const observed = [];
  for (const name of ['truncated-audit', 'undecodable-audit', 'missing-audit', 'missing-worker']) {
    const { path, manifest, dir } = await rootFixture(name);
    if (name === 'truncated-audit' || name === 'undecodable-audit') {
      const data = name === 'truncated-audit' ? '{"decision_id":' : Buffer.from([255]);
      await fs.writeFile(join(dir, 'audit.jsonl'), data, { mode: 0o600 });
      manifest.decisions.push({ path: 'audit.jsonl', sha256: sha(data) });
    } else if (name === 'missing-audit') manifest.decisions.push({ path: 'absent.jsonl', sha256: 'a'.repeat(64) });
    else manifest.captures.push({ path: 'absent.jsonl', thread_id: 'worker', sha256: 'a'.repeat(64) });
    await fs.writeFile(path, JSON.stringify(manifest)); const result = invoke(path);
    assert.equal(result.status, 1); const output = JSON.parse(result.stdout);
    observed.push(output.known_lower_bound.codex_total_tokens);
    assert.equal(output.jev_usage.total_tokens, null); assert.equal(output.task_coverage_verified, false);
  }
  assert.deepEqual(observed, [40, 40, 40, 40]);
});

// Exported readers keep the same generic diagnostic boundary as their CLI entry points.
test('task_usage_exported_loader_errors_do_not_include_private_bytes_or_paths', async () => {
  const { path, dir } = await fixture('loader-errors');
  await fs.writeFile(path, 'PRIVATE_TRANSCRIPT_VALUE');
  const errors = [];
  for (const operation of [() => loadPrivateTaskMeasurement(path),
    () => resolvePrivateTaskReference(dir, 'PRIVATE_TRANSCRIPT_VALUE')]) {
    try { await operation(); assert.fail('Expected input rejection'); }
    catch (error) { errors.push(error.message); }
  }
  assert.equal(errors.some(message => message.includes('PRIVATE') || message.includes(dir)), false);
});

// One descriptor cannot borrow another file's matching hash to hide unbilled attempts.
test('task_usage_cli_binds_each_decision_descriptor_to_its_own_bytes', async () => {
  const { path, manifest, dir } = await rootFixture('decision-source-binding');
  const record = { decision_id: 'known', session_id: 'root', turn_id: 'child-turn', provider_attempts: 1,
    provider_usage: { input_tokens: 7, output_tokens: 3 }, versions: { jev_model: 'fixture-model' } };
  const good = JSON.stringify(record) + '\n'; const unknown = JSON.stringify({ ...record, decision_id: 'unknown', provider_usage: null }) + '\n';
  await fs.writeFile(join(dir, 'known.jsonl'), good, { mode: 0o600 });
  await fs.writeFile(join(dir, 'unknown.jsonl'), unknown, { mode: 0o600 });
  manifest.decisions = [{ path: 'unknown.jsonl', sha256: sha(good) }, { path: 'known.jsonl', sha256: sha(good) }];
  await fs.writeFile(path, JSON.stringify(manifest)); const result = invoke(path); assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).observed_providers.jev.available, false);
});

// Crashes after file creation leave safe empty evidence, not a reason to erase other observations.
test('task_usage_cli_preserves_root_lower_bound_with_empty_audit_or_worker', async () => {
  const observed = [];
  for (const name of ['empty-audit', 'empty-worker']) {
    const { path, manifest, dir } = await rootFixture(name);
    await fs.writeFile(join(dir, 'empty.jsonl'), '', { mode: 0o600 });
    if (name === 'empty-audit') manifest.decisions.push({ path: 'empty.jsonl', sha256: sha('') });
    else manifest.captures.push({ path: 'empty.jsonl', sha256: sha(''), thread_id: 'worker' });
    await fs.writeFile(path, JSON.stringify(manifest)); const result = invoke(path); assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout); observed.push(output.known_lower_bound.codex_total_tokens);
    assert.equal(output.task_coverage_verified, false); assert.equal(output.jev_usage.total_tokens, null);
  }
  assert.deepEqual(observed, [40, 40]);
});

// Bounded files can still exceed the invocation budget when read repeatedly.
test('task_usage_loader_shares_record_and_identity_limits_across_files', async () => {
  const { path, manifest, dir } = await rootFixture('shared-records');
  const base = await fs.readFile(join(dir, 'root.jsonl'), 'utf8');
  const baseCount = base.trim().split('\n').length;
  const descriptors = [];
  for (const [index, count] of [100_000, 100_000, 50_000].entries()) {
    const data = base + '{}\n'.repeat(count - baseCount); const name = 'capture-' + index + '.jsonl';
    await fs.writeFile(join(dir, name), data, { mode: 0o600 });
    descriptors.push({ path: name, thread_id: 'root', sha256: sha(data) });
  }
  // Exact read-budget admission is independent of conflicting root capture admission.
  manifest.captures = descriptors; await fs.writeFile(path, JSON.stringify(manifest));
  await assert.doesNotReject(loadPrivateTaskMeasurement(path));
  await fs.appendFile(join(dir, descriptors[2].path), '{}\n');
  await assert.rejects(loadPrivateTaskMeasurement(path), /budget/);

});

// Repeated decision paths reuse one bounded projection instead of retaining nested raw bodies.
test('task_usage_loader_normalizes_decisions_and_reads_repeated_sources_once', async () => {
  const { path, manifest, dir } = await rootFixture('typed-decision-bodies');
  const record = { decision_id: 'known', session_id: 'root', turn_id: 'child-turn', provider_attempts: 1,
    provider_usage: { input_tokens: 7, output_tokens: 3, ignored: { body: 'PRIVATE_NESTED'.repeat(1000) } },
    versions: { jev_model: 'fixture-model', ignored: { body: 'PRIVATE_NESTED'.repeat(1000) } } };
  const reordered = structuredClone(record); reordered.provider_usage.ignored = { different: 'PRIVATE_NESTED' };
  const bytes = [record, reordered].map(JSON.stringify).join('\n') + '\n'; const audit = join(dir, 'audit');
  await fs.writeFile(audit, bytes, { mode: 0o600 });
  manifest.decisions = Array.from({ length: 128 }, () => ({ path: 'audit', sha256: sha(bytes) }));
  await fs.writeFile(path, JSON.stringify(manifest));
  const original = fs.open; let opens = 0;
  const mocked = mock.method(fs, 'open', async (...args) => {
    if (args[0] === audit) opens++;
    return original(...args);
  });
  try {
    const result = await loadPrivateTaskMeasurement(path);
    assert.deepEqual(result.known_lower_bound, { codex_total_tokens: 40, jev_total_tokens: 10 });
    assert.equal(opens, 1, 'Repeated descriptors must reuse the same source snapshot');
  } finally { mocked.mock.restore(); }
  // A nested model is unknown billing, while a different independently valid decision survives.
  record.decision_id = 'malformed'; record.versions = { jev_model: { nested: 'PRIVATE_NESTED'.repeat(1000) } };
  const malformed = JSON.stringify(record) + '\n';
  await fs.writeFile(join(dir, 'malformed'), malformed, { mode: 0o600 });
  manifest.decisions.push({ path: 'malformed', sha256: sha(malformed) });
  manifest.decisions.shift(); await fs.writeFile(path, JSON.stringify(manifest));
  assert.deepEqual((await loadPrivateTaskMeasurement(path)).known_lower_bound,
    { codex_total_tokens: 40, jev_total_tokens: 10 });
});

// Detected mid-read instability rejects the load, unlike stable malformed source contents.
test('task_usage_loader_rejects_mutated_capture_and_decision_snapshots', async () => {
  for (const kind of ['capture', 'decision']) for (const change of ['rewrite', 'parse-rewrite', 'truncate', 'replace', 'read-error']) {
    const { path, manifest, dir } = await rootFixture('unstable-' + kind + '-' + change);
    const target = join(dir, kind === 'capture' ? 'worker.jsonl' : 'audit');
    if (kind === 'decision') await fs.writeFile(target, JSON.stringify({ decision_id: 'known', session_id: 'root',
      turn_id: 'child-turn', provider_attempts: 1, provider_usage: { input_tokens: 7, output_tokens: 3 },
      versions: { jev_model: 'fixture-model' } }) + '\n', { mode: 0o600 });
    const bytes = await fs.readFile(target); const descriptor = { path: target.split('/').at(-1), sha256: sha(bytes) };
    if (kind === 'capture') manifest.captures.push({ ...descriptor, thread_id: 'worker' });
    else manifest.decisions.push(descriptor);
    await fs.writeFile(path, JSON.stringify(manifest));
    const original = fs.open; let closed = false;
    const mocked = mock.method(fs, 'open', async (...args) => {
      const file = await original(...args); if (args[0] !== target) return file;
      const stat = file.stat.bind(file), read = file.read.bind(file), close = file.close.bind(file); let stats = 0, reads = 0;
      file.close = async () => { closed = true; return close(); };
      file.stat = async (...statArgs) => {
        if (++stats === 2 && change === 'rewrite') {
          await fs.writeFile(target, bytes.toString().replace('fixture-model', 'fixture-modeX'));
          const changed = new Date(Date.now() + 2000); await fs.utimes(target, changed, changed);
        }
        return stat(...statArgs);
      };
      file.read = async (...readArgs) => {
        if (++reads === 1) {
          if (change === 'truncate') await fs.truncate(target, 1);
          if (change === 'parse-rewrite') await fs.writeFile(target, 'x'.repeat(bytes.length));
          if (change === 'replace') {
            await fs.rename(target, target + '-old'); await fs.writeFile(target, bytes, { mode: 0o600 });
            const changed = new Date(Date.now() + 2000); await fs.utimes(target + '-old', changed, changed);
          }
          if (change === 'read-error') throw new Error('PRIVATE_SOURCE_READ_ERROR');
        }
        return read(...readArgs);
      };
      return file;
    });
    try {
      await assert.rejects(loadPrivateTaskMeasurement(path), /private manifest or budget rejected/, kind + '/' + change);
      assert.equal(closed, true);
    } finally { mocked.mock.restore(); }
  }
});

// Unique decisions share one invocation cap, even when each source stays below file limits.
test('task_usage_loader_shares_identity_limits_across_files', async () => {
  const { path, manifest, dir } = await rootFixture('shared-identities');
  manifest.captures = []; manifest.intervals = [];
  const decisions = Array.from({ length: 100_000 }, (_, i) => JSON.stringify({ decision_id: String(i) })).join('\n') + '\n';
  await fs.writeFile(join(dir, 'decisions.jsonl'), decisions, { mode: 0o600 });
  manifest.decisions = [{ path: 'decisions.jsonl', sha256: sha(decisions) }];
  await fs.writeFile(path, JSON.stringify(manifest));
  await assert.doesNotReject(loadPrivateTaskMeasurement(path));
  const extra = '{"decision_id":"new"}\n';
  await fs.writeFile(join(dir, 'extra.jsonl'), extra, { mode: 0o600 });
  manifest.decisions.push({ path: 'extra.jsonl', sha256: sha(extra) });
  await fs.writeFile(path, JSON.stringify(manifest));
  await assert.rejects(loadPrivateTaskMeasurement(path), /budget/);
});

// Response subject names cannot alias the provider namespace at the combined identity cap.
test('task_usage_loader_separates_response_and_decision_identity_kinds', async () => {
  const { path, manifest, dir } = await rootFixture('mixed-identity-kinds');
  const rows = (await fs.readFile(join(dir, 'root.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  for (const row of rows) {
    if (row.type === 'session_meta') row.payload.id = 'jev-decision';
    if (row.type === 'token_usage_record') { row.payload.thread_id = 'jev-decision'; row.payload.response_id = '0'; }
  }
  const capture = rows.map(JSON.stringify).join('\n') + '\n';
  await fs.writeFile(join(dir, 'root.jsonl'), capture, { mode: 0o600 });
  manifest.captures = [{ path: 'root.jsonl', thread_id: 'jev-decision', sha256: sha(capture) }];
  manifest.intervals = [];
  for (const count of [99_999, 100_000]) {
    const decisions = Array.from({ length: count }, (_, i) => JSON.stringify({ decision_id: String(i) })).join('\n') + '\n';
    await fs.writeFile(join(dir, 'decisions'), decisions, { mode: 0o600 });
    manifest.decisions = [{ path: 'decisions', sha256: sha(decisions) }];
    await fs.writeFile(path, JSON.stringify(manifest));
    if (count === 99_999) await assert.doesNotReject(loadPrivateTaskMeasurement(path));
    else await assert.rejects(loadPrivateTaskMeasurement(path), /budget/);
  }
});

// A safely empty source consumes no bytes even when earlier captures use the exact cap.
test('task_usage_loader_preserves_bounds_with_empty_capture_at_exact_byte_cap', async () => {
  const { path, manifest, dir } = await rootFixture('empty-at-byte-cap');
  const size = (await fs.stat(join(dir, 'root.jsonl'))).size;
  await fs.writeFile(join(dir, 'empty'), '', { mode: 0o600 });
  manifest.captures.push({ path: 'empty', thread_id: 'absent-worker', sha256: sha('') });
  await fs.writeFile(path, JSON.stringify(manifest));
  assert.equal((await loadPrivateTaskMeasurement(path, size)).known_lower_bound.codex_total_tokens, 40);
});

// A source-local decoded cap rejects that source while independent source-bound contributions survive.
test('task_usage_loader_preserves_independent_bounds_beside_source_local_limits', async () => {
  for (const kind of ['capture-line', 'capture-records', 'decision-records']) {
    const { path, manifest, dir } = await rootFixture('source-limit-' + kind);
    const bad = kind === 'capture-line' ? JSON.stringify({ ignored: 'x'.repeat(1_000_000) }) + '\n' : '{}\n'.repeat(100_001);
    await fs.writeFile(join(dir, 'over-limit'), bad, { mode: 0o600 });
    if (kind.startsWith('capture')) manifest.captures.push({ path: 'over-limit', thread_id: 'worker', sha256: sha(bad) });
    else manifest.decisions.push({ path: 'over-limit', sha256: sha(bad) });
    const good = JSON.stringify({ decision_id: 'known', session_id: 'root', turn_id: 'child-turn', provider_attempts: 1,
      provider_usage: { input_tokens: 7, output_tokens: 3 }, versions: { jev_model: 'fixture-model' } }) + '\n';
    await fs.writeFile(join(dir, 'known'), good, { mode: 0o600 });
    manifest.decisions.push({ path: 'known', sha256: sha(good) });
    await fs.writeFile(path, JSON.stringify(manifest));
    const result = await loadPrivateTaskMeasurement(path);
    assert.deepEqual(result.known_lower_bound, { codex_total_tokens: 40, jev_total_tokens: 10 });
    assert.equal(result.task_coverage_verified, false);
  }
});
