import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, lstat, access, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readContextPolicyConfig, handleCodexHook } from '../src/codex-context-policy.mjs';
import { updateContextPolicyInstall } from '../scripts/manage-context-policy.mjs';

const sourceRoot = resolve('.');
const emptyHookResult = { stdout: '', stderr: '', exit_code: 0 };
const foreignHooks = { description: 'Write guard', hooks: {
  PreToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'existing-write-guard' }] }],
  UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'existing-context' }] }],
} };

async function createInstallTarget(coverage = true) {
  const root = await mkdtemp(join(tmpdir(), "context installer '$ quoted-"));
  await mkdir(join(root, '.codex'));
  await writeFile(join(root, '.codex/hooks.json'), JSON.stringify(foreignHooks));
  if (coverage) await writeFile(join(root, '.codex/codex-context-policy-coverage.json'), JSON.stringify({
    client_version: '0.159.2', events: { UserPromptSubmit: 'supported' },
  }));
  return root;
}

// This boundary catches overwrite-all installation and deletion of foreign hooks.
test('off_and_additive_install', async () => {
  const repoRoot = await createInstallTarget();
  const operation = { repo_root: repoRoot, source_root: sourceRoot, action: 'install', apply: false };
  const hooksPath = join(repoRoot, '.codex/hooks.json');
  const originalBytes = await readFile(hooksPath, 'utf8');
  const preview = await updateContextPolicyInstall(operation);
  assert.equal(preview.error, null);
  assert.equal(preview.changed, true);
  assert.equal(await readFile(hooksPath, 'utf8'), originalBytes);
  assert.equal(await access(join(repoRoot, '.codex/codex-context-policy.json')).then(() => true, () => false), false);
  const installed = await updateContextPolicyInstall({ ...operation, apply: true });
  assert.equal(installed.error, null);
  const installedHooks = JSON.parse(await readFile(hooksPath, 'utf8'));
  assert.deepEqual(installedHooks.hooks.PreToolUse, foreignHooks.hooks.PreToolUse);
  assert.deepEqual(installedHooks.hooks.UserPromptSubmit[0], foreignHooks.hooks.UserPromptSubmit[0]);
  assert.equal(installedHooks.hooks.UserPromptSubmit.length, 2);
  assert.deepEqual(await readContextPolicyConfig(repoRoot), { mode: 'off', jev_enabled: true, operations: {} });
  assert.deepEqual(await handleCodexHook({ hook_event_name: 'UserPromptSubmit', cwd: repoRoot, session_id: 's1', prompt: 'git status' }), emptyHookResult);
  const command = installedHooks.hooks.UserPromptSubmit[1].hooks[0].command;
  const child = spawnSync('/bin/sh', ['-c', command], { cwd: repoRoot, input: JSON.stringify({ cwd: repoRoot, hook_event_name: 'UserPromptSubmit', session_id: 's1' }), encoding: 'utf8', timeout: 3000 });
  assert.equal(child.status, 0);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, '');
  const bytesBeforeRepeat = await readFile(hooksPath, 'utf8');
  assert.equal((await updateContextPolicyInstall({ ...operation, apply: true })).changed, false);
  assert.equal(await readFile(hooksPath, 'utf8'), bytesBeforeRepeat);
  const extra = { hooks: [{ type: 'command', command: 'foreign-added-after-install' }] };
  installedHooks.hooks.UserPromptSubmit.push(extra);
  await writeFile(hooksPath, JSON.stringify(installedHooks));
  const removed = await updateContextPolicyInstall({ ...operation, action: 'remove', apply: true });
  assert.equal(removed.error, null);
  const afterRemoval = JSON.parse(await readFile(hooksPath, 'utf8'));
  assert.deepEqual(afterRemoval.hooks.PreToolUse, foreignHooks.hooks.PreToolUse);
  assert.deepEqual(afterRemoval.hooks.UserPromptSubmit, [...foreignHooks.hooks.UserPromptSubmit, extra]);
  assert.equal((await updateContextPolicyInstall({ ...operation, action: 'remove', apply: true })).changed, false);
  assert.equal((await lstat(hooksPath)).mode & 0o777, 0o644);
});

// Native Codex discovers linked-worktree hooks in the primary checkout.
test('linked_worktree_install_uses_primary_hook_registration', async () => {
  const repoRoot = await realpath(await createInstallTarget());
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  for (const args of [['init', '--initial-branch=fixture-main'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'fixture']]) {
    assert.equal(spawnSync('git', args, { cwd: repoRoot, env: environment }).status, 0);
  }
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'context-linked-')));
  const worktree = join(parent, 'worktree');
  assert.equal(spawnSync('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], { cwd: repoRoot, env: environment }).status, 0);
  await mkdir(join(worktree, '.codex'));
  const localHooks = JSON.stringify({ hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: 'local-foreign' }] }] } });
  await writeFile(join(worktree, '.codex/hooks.json'), localHooks);
  await writeFile(join(worktree, '.codex/codex-context-policy-coverage.json'), await readFile(join(repoRoot, '.codex/codex-context-policy-coverage.json')));
  const operation = { repo_root: worktree, source_root: sourceRoot, action: 'install', apply: true };
  const original = await readFile(join(repoRoot, '.codex/hooks.json'), 'utf8');
  const preview = await updateContextPolicyInstall({ ...operation, apply: false });
  assert.equal(preview.error, null);
  assert.equal(await readFile(join(repoRoot, '.codex/hooks.json'), 'utf8'), original);
  const installed = await updateContextPolicyInstall(operation);
  assert.equal(installed.error, null);
  const primary = JSON.parse(await readFile(join(repoRoot, '.codex/hooks.json'), 'utf8'));
  assert.equal(primary.hooks.UserPromptSubmit.length, 2);
  assert.deepEqual(primary.hooks.PreToolUse, foreignHooks.hooks.PreToolUse);
  assert.equal(await readFile(join(worktree, '.codex/hooks.json'), 'utf8'), localHooks);
  assert.deepEqual(await readContextPolicyConfig(worktree), { mode: 'off', jev_enabled: true, operations: {} });
  assert.equal(await access(join(repoRoot, '.codex/codex-context-policy.json')).then(() => true, () => false), false);
  assert.equal((await updateContextPolicyInstall(operation)).changed, false);
  assert.equal((await updateContextPolicyInstall({ ...operation, action: 'remove' })).error, null);
  assert.deepEqual(JSON.parse(await readFile(join(repoRoot, '.codex/hooks.json'), 'utf8')), foreignHooks);
  assert.equal(await readFile(join(worktree, '.codex/hooks.json'), 'utf8'), localHooks);
});

test('invalid_configuration_is_off_and_malformed_hooks_are_preserved', async () => {
  const repoRoot = await createInstallTarget();
  const configPath = join(repoRoot, '.codex/codex-context-policy.json');
  for (const text of ['not json', 'null', '{}', '{"mode":"enforce","jev_enabled":"yes"}', '{"mode":"bad","jev_enabled":true}']) {
    await writeFile(configPath, text);
    assert.equal((await readContextPolicyConfig(repoRoot)).mode, 'off');
    assert.deepEqual(await handleCodexHook({ cwd: repoRoot, hook_event_name: 'UserPromptSubmit', session_id: 'one' }), emptyHookResult);
  }
  await writeFile(join(repoRoot, '.codex/hooks.json'), '{ broken');
  const result = await updateContextPolicyInstall({ repo_root: repoRoot, source_root: sourceRoot, action: 'install', apply: true });
  assert.ok(result.error);
  assert.equal(await readFile(join(repoRoot, '.codex/hooks.json'), 'utf8'), '{ broken');
});

test('unverified_hooks_and_external_symlinks_are_not_installed', async () => {
  const repoRoot = await createInstallTarget(false);
  const result = await updateContextPolicyInstall({ repo_root: repoRoot, source_root: sourceRoot, action: 'install', apply: true });
  assert.equal(result.error, null);
  assert.deepEqual(JSON.parse(await readFile(join(repoRoot, '.codex/hooks.json'), 'utf8')), foreignHooks);
  const outside = await mkdtemp(join(tmpdir(), 'context-outside-'));
  const maliciousRoot = await mkdtemp(join(tmpdir(), 'context-symlink-'));
  await symlink(outside, join(maliciousRoot, '.codex'));
  const rejected = await updateContextPolicyInstall({ repo_root: maliciousRoot, source_root: sourceRoot, action: 'install', apply: true });
  assert.ok(rejected.error);
  assert.equal(await access(join(outside, 'hooks.json')).then(() => true, () => false), false);
});

// This probe must not turn its compatibility log into a transcript or code log.
test('compatibility_probe_records_only_metadata', async () => {
  const repoRoot = await createInstallTarget(false);
  const marker = 'probe-marker-72';
  const probe = resolve('tests/context-hook-probe.mjs');
  const input = { cwd: repoRoot, session_id: 'probe-session', turn_id: 'probe-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'SECRET_TEST_VALUE', tool_input: { command: 'PRIVATE_CODE_VALUE' } };
  const child = spawnSync(process.execPath, [probe, repoRoot, marker], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 3000,
  });
  assert.equal(child.status, 0);
  assert.match(child.stdout, /probe-marker-72/);
  const text = await readFile(join(repoRoot, '.codex/context-hook-probe.jsonl'), 'utf8');
  assert.equal(text.includes('SECRET_TEST_VALUE'), false);
  assert.equal(text.includes('PRIVATE_CODE_VALUE'), false);
  const records = text.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(records[0].hook_event_name, 'UserPromptSubmit');
  assert.match(records[0].session_hash, /^[a-f0-9]{64}$/);
  assert.equal((await lstat(join(repoRoot, '.codex/context-hook-probe.jsonl'))).mode & 0o777, 0o600);
  const tool = spawnSync(process.execPath, [probe, repoRoot, marker], {
    input: JSON.stringify({ ...input, hook_event_name: 'PreToolUse' }), encoding: 'utf8', timeout: 3000,
  });
  assert.equal(tool.status, 0);
  assert.equal(tool.stdout, '');
});
