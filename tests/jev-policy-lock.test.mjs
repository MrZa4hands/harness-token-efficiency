import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fileSystem, { mkdtemp, mkdir, writeFile, readFile, realpath, unlink } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { configureJevModel } from '../src/jev-client.mjs';
import { setContextPolicyMode } from '../scripts/manage-context-policy.mjs';

const temporary = await realpath(await mkdtemp(join(tmpdir(), 'jev-policy-lock-')));
after(() => assert.equal(spawnSync('trash', [temporary]).status, 0));
const options = { apiKey: 'fixture-key', fetchImpl: async () => new Response(JSON.stringify({ models: [
  { name: 'jev-fixture-alias', description: 'Fixture only', release_date: '2026-09-15' }] })) };

// Setup is another writer of the same bounded runtime policy.
test('jev_setup_rejects_unreadable_canonical_policy', async () => {
  const root = await mkdtemp(join(temporary, 'expansion-')); await mkdir(join(root, '.codex'), { mode: 0o700 });
  const path = join(root, '.codex/codex-context-policy.json');
  const text = JSON.stringify({ mode: 'shadow', jev_enabled: true, padding: Array(4500).fill(null) });
  assert.ok(Buffer.byteLength(text) < 32000); await writeFile(path, text, { mode: 0o600 });
  assert.equal((await configureJevModel(root, options)).status, 'abstain');
  assert.equal(await readFile(path, 'utf8'), text);
});

// The install/mode lock must exclude Jev setup in both a primary checkout and its registered worktree.
test('jev_setup_honors_primary_shared_policy_lock', async () => {
  const primary = await mkdtemp(join(temporary, 'primary-')); const worktree = join(temporary, 'worktree');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = args => spawnSync('git', ['-C', primary, ...args], { env, encoding: 'utf8', timeout: 3000 });
  assert.equal(git(['-c', 'init.templateDir=', 'init', '--initial-branch=fixture-main']).status, 0);
  assert.equal(git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'fixture']).status, 0);
  assert.equal(git(['worktree', 'add', '-b', 'fixture-worktree', worktree]).status, 0);
  for (const root of [primary, worktree]) {
    await mkdir(join(root, '.codex'), { mode: 0o700 });
    await writeFile(join(root, '.codex/codex-context-policy.json'), '{"mode":"shadow","jev_enabled":true}', { mode: 0o600 });
  }
  const lockPath = join(primary, '.codex/.codex-context-policy-install.lock');
  await writeFile(lockPath, 'active installer', { mode: 0o600 });
  for (const root of [primary, worktree]) {
    const before = await readFile(join(root, '.codex/codex-context-policy.json'), 'utf8');
    assert.equal((await configureJevModel(root, options)).status, 'abstain', 'Shared lock must exclude Jev policy writes');
    assert.equal(await readFile(join(root, '.codex/codex-context-policy.json'), 'utf8'), before);
  }
  await unlink(lockPath);
  assert.equal((await configureJevModel(worktree, options)).status, 'ok');
});

// A mode change between Jev's final comparison and rename must be excluded instead of overwritten.
test('jev_setup_excludes_mode_change_at_final_rename', async () => {
  const root = await mkdtemp(join(temporary, 'race-')); await mkdir(join(root, '.codex'), { mode: 0o700 });
  const path = join(root, '.codex/codex-context-policy.json');
  await writeFile(path, '{"mode":"shadow","jev_enabled":true}', { mode: 0o600 });
  const originalRename = fileSystem.rename; let modeResult;
  try {
    fileSystem.rename = async (from, to) => {
      if (String(from).includes('/.jev-setup-')) modeResult = await setContextPolicyMode(root, 'off');
      return originalRename(from, to);
    };
    syncBuiltinESMExports();
    assert.equal((await configureJevModel(root, options)).status, 'ok');
  } finally { fileSystem.rename = originalRename; syncBuiltinESMExports(); }
  assert.equal(modeResult.changed, false, 'Concurrent mode change must not report a change later overwritten by Jev');
  assert.ok(modeResult.error);
  assert.equal((await setContextPolicyMode(root, 'off')).error, null);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).mode, 'off', 'A retry after setup must remain immediately effective');
});
