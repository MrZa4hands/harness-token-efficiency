import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
