import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { rewriteContextCommand, handleCodexHook } from '../src/codex-context-policy.mjs';
import { updateContextPolicyInstall } from '../scripts/manage-context-policy.mjs';

const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'context-rewrite-tests-')));
after(() => assert.equal(spawnSync('trash', [temporaryRoot]).status, 0));

// Any admitted candidate without real permission/error equivalence, or changing unrelated native inputs, breaks passthrough.
test('simple_rewrite_preserves_semantics', async () => {
  const commands = ['git status', 'git status --short', 'git status --short --branch', 'git status | cat',
    'git status > out', 'git status <<EOF', 'git status\nwhoami', 'git status && whoami', 'git status; whoami',
    'git status $(whoami)', 'git status `whoami`', 'LANG=C git status', 'git "status"', 'git status --porcelain=v2',
    'rtk git status', 'git diff', 'git show HEAD', 'mcp repository status'];
  for (const command of commands) assert.equal(rewriteContextCommand(command), null,
    'No candidate has verified native permission equivalence: ' + command);
  const root = await mkdtemp(join(temporaryRoot, 'repository-'));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'init.templateDir=', 'init', '--initial-branch=fixture-main'], { cwd: root, env });
  assert.equal((await updateContextPolicyInstall({ repo_root: root, source_root: resolve('.'), action: 'install', apply: true })).error, null);
  for (const mode of ['off', 'shadow', 'enforce']) {
    await writeFile(join(root, '.codex/codex-context-policy.json'), JSON.stringify({ mode, jev_enabled: false,
      operations: { rewrite_simple_command: 'enforce' } }), { mode: 0o600 });
    for (const [tool, command] of [['exec_command', 'git status'], ['functions.exec', "await tools.exec_command({cmd:'git status'})"],
      ['mcp__repository__status', 'git status'], ['write_stdin', 'git status']]) {
      const input = { hook_event_name: 'PreToolUse', cwd: root, session_id: 'rewrite-session', tool_name: tool,
        tool_input: { cmd: command, workdir: root, yield_time_ms: 1000, tty: false, max_output_tokens: 700 },
        client_version: '0.159.2', permission_mode: 'read-only' };
      const original = structuredClone(input);
      assert.deepEqual(await handleCodexHook(input, resolve('.')), { stdout: '', stderr: '', exit_code: 0 });
      assert.deepEqual(input, original, 'Tool name, command, cwd, timing, terminal and output fields must remain intact');
    }
    const denied = { hook_event_name: 'PermissionRequest', cwd: root, session_id: 'rewrite-session',
      tool_name: 'exec_command', tool_input: { cmd: 'git status', workdir: root }, permission_mode: 'read-only' };
    assert.equal((await handleCodexHook(denied, resolve('.'))).stdout, '', 'Never grant a native PermissionRequest decision');
  }
});
