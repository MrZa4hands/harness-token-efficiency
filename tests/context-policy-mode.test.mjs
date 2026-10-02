import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { updateContextPolicyInstall } from '../scripts/manage-context-policy.mjs';
import { readContextPolicyConfig, handleCodexHook } from '../src/codex-context-policy.mjs';

const temporary = await realpath(await mkdtemp(join(tmpdir(), 'context-mode-tests-')));
after(() => assert.equal(spawnSync('trash', [temporary]).status, 0));
const manager = resolve('scripts/manage-context-policy.mjs');
const invoke = (root, mode, extra = []) => spawnSync(process.execPath, [manager, 'mode', mode, '--repo', root, ...extra],
  { encoding: 'utf8', timeout: 3000 });

// A mode switch must affect the next native call without touching foreign registration or other policy fields.
test('mode_cli_changes_only_mode_and_off_is_immediate', async () => {
  const root = await mkdtemp(join(temporary, 'installed-')); const directory = join(root, '.codex');
  await mkdir(directory, { mode: 0o700 });
  const foreign = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'foreign-write-guard' }] }] } };
  const hooks = join(directory, 'hooks.json'); await writeFile(hooks, JSON.stringify(foreign), { mode: 0o600 });
  assert.equal((await updateContextPolicyInstall({ repo_root: root, source_root: resolve('.'), action: 'install', apply: true })).error, null);
  const path = join(directory, 'codex-context-policy.json');
  const policy = { mode: 'shadow', jev_enabled: false, jev_model: 'saved-alias', operator_note: 'preserve',
    operations: { code_context: 'enforce', run_project_checks: 'off' } };
  await writeFile(path, JSON.stringify(policy), { mode: 0o600 }); const originalHooks = await readFile(hooks, 'utf8');
  for (const mode of ['off', 'enforce', 'shadow', 'off']) {
    const child = invoke(root, mode); assert.equal(child.status, 0, child.stderr + child.stdout);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { ...policy, mode });
    assert.equal((await readContextPolicyConfig(root)).mode, mode); assert.equal(await readFile(hooks, 'utf8'), originalHooks);
    assert.equal((await lstat(path)).mode & 0o777, 0o600);
  }
  assert.deepEqual(await handleCodexHook({ hook_event_name: 'UserPromptSubmit', cwd: root, session_id: 'mode-session',
    prompt: 'Explain missing.mjs.', model: 'fixture-model' }), { stdout: '', stderr: '', exit_code: 0 });
  assert.equal(JSON.parse(invoke(root, 'off').stdout).changed, false, 'Repeated off leaves existing bytes unchanged');
  const final = await readFile(path, 'utf8');
  for (const [mode, extra] of [['bad', []], ['off', ['--configure-jev']], ['off', ['--source', resolve('.')]]]) {
    assert.equal(invoke(root, mode, extra).status, 1); assert.equal(await readFile(path, 'utf8'), final);
  }
  const missingRoot = spawnSync(process.execPath, [manager, 'mode', 'off'], { encoding: 'utf8', timeout: 3000 });
  assert.equal(missingRoot.status, 1);
  assert.match(missingRoot.stderr, /mode off\|shadow\|enforce --repo PATH;/, 'Immediate mode command must omit unsupported apply syntax');
  const result = await updateContextPolicyInstall({ repo_root: root, source_root: resolve('.'), action: 'remove', apply: true });
  assert.equal(result.error, null); assert.deepEqual(JSON.parse(await readFile(hooks, 'utf8')), foreign);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { ...policy, mode: 'off' }, 'Modified policy survives owned removal');
});

// Unsafe, invalid or busy files must be rejected without replacing policy or dereferencing foreign paths.
test('mode_cli_preserves_rejected_files_and_busy_locks', async () => {
  for (const kind of ['malformed', 'invalid', 'oversized', 'fifo', 'symlink', 'busy']) {
    const root = await mkdtemp(join(temporary, 'reject-')); const directory = join(root, '.codex');
    await mkdir(directory, { mode: 0o700 }); const path = join(directory, 'codex-context-policy.json');
    const text = kind === 'malformed' ? '{' : kind === 'invalid' ? '{"mode":"invalid","jev_enabled":false}' :
      JSON.stringify({ mode: 'shadow', jev_enabled: false, ...(kind === 'oversized' ? { padding: 'x'.repeat(32001) } : {}) });
    if (kind === 'fifo') assert.equal(spawnSync('mkfifo', [path]).status, 0);
    else if (kind === 'symlink') { const target = join(root, 'foreign.json'); await writeFile(target, text); await symlink(target, path); }
    else await writeFile(path, text, { mode: 0o600 });
    if (kind === 'busy') await writeFile(join(directory, '.codex-context-policy-install.lock'), 'live owner', { mode: 0o600 });
    const child = invoke(root, 'off'); assert.equal(child.status, 1, kind); assert.ok(child.error === undefined, 'Must settle, including FIFO');
    if (kind !== 'fifo') assert.equal(await readFile(path, 'utf8'), text, kind);
  }
});
