import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, lstat, access, symlink, realpath, copyFile, chmod, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import installFileSystem from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { readContextPolicyConfig, handleCodexHook } from '../src/codex-context-policy.mjs';
import { updateContextPolicyInstall } from '../scripts/manage-context-policy.mjs';

const sourceRoot = resolve('.');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'context-install-tests-'));
after(() => assert.equal(spawnSync('trash', [temporaryRoot]).status, 0));
const emptyHookResult = { stdout: '', stderr: '', exit_code: 0 };
const foreignHooks = { description: 'Write guard', hooks: {
  PreToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'existing-write-guard' }] }],
  UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'existing-context' }] }],
} };

async function createInstallTarget(coverage = true) {
  const root = await mkdtemp(join(temporaryRoot, "context installer '$ quoted-"));
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
  const originalMode = (await lstat(hooksPath)).mode & 0o777;
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
  const malformed = spawnSync('/bin/sh', ['-c', command], {
    cwd: repoRoot, input: '{ PRIVATE_MALFORMED_INPUT', encoding: 'utf8', timeout: 3000,
  });
  assert.equal(malformed.status, 0);
  assert.equal(malformed.stdout, '');
  assert.match(malformed.stderr, /Context hook input rejected/);
  assert.equal(malformed.stderr.includes('PRIVATE_MALFORMED_INPUT'), false);
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
  assert.equal((await lstat(hooksPath)).mode & 0o777, originalMode);
});

// Native Codex discovers linked-worktree hooks in the primary checkout.
test('linked_worktree_install_uses_primary_hook_registration', async () => {
  const repoRoot = await realpath(await createInstallTarget());
  const environment = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  for (const args of [['-c', 'init.templateDir=', 'init', '--initial-branch=fixture-main'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'fixture']]) {
    assert.equal(spawnSync('git', args, { cwd: repoRoot, env: environment }).status, 0);
  }
  const parent = await realpath(await mkdtemp(join(temporaryRoot, 'context-linked-')));
  const worktree = join(parent, 'worktree');
  assert.equal(spawnSync('git', ['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', worktree, 'HEAD'], { cwd: repoRoot, env: environment }).status, 0);
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
  const overlap = await updateContextPolicyInstall({ ...operation, repo_root: repoRoot });
  assert.ok(overlap.error, 'An unrelated installation must not borrow the existing owner\'s hook');
  assert.equal(await access(join(repoRoot, '.codex/codex-context-policy-install.json')).then(() => true, () => false), false);
  assert.equal(await access(join(repoRoot, '.codex/codex-context-policy.json')).then(() => true, () => false), false);
  assert.equal((await updateContextPolicyInstall({ ...operation, action: 'remove' })).error, null);
  assert.deepEqual(JSON.parse(await readFile(join(repoRoot, '.codex/hooks.json'), 'utf8')), foreignHooks);
  assert.equal(await readFile(join(worktree, '.codex/hooks.json'), 'utf8'), localHooks);
});

// A disk failure must not register hooks without durable ownership or hide prior writes.
test('installation_write_failures_preserve_ownership_and_allow_recovery', async () => {
  for (const failedFile of ['codex-context-policy-install.json.', 'codex-context-policy.json.']) {
    const repoRoot = await createInstallTarget();
    const hooksPath = join(repoRoot, '.codex/hooks.json');
    const original = await readFile(hooksPath, 'utf8');
    const operation = { repo_root: repoRoot, source_root: sourceRoot, action: 'install', apply: true };
    const originalWrite = installFileSystem.writeFile;
    let failed;
    try {
      installFileSystem.writeFile = async (path, ...args) => {
        if (String(path).includes(failedFile) && String(path).endsWith('.tmp')) {
          throw Object.assign(new Error('Synthetic installation disk failure'), { code: 'EIO' });
        }
        return originalWrite(path, ...args);
      };
      syncBuiltinESMExports();
      failed = await updateContextPolicyInstall(operation);
    } finally {
      installFileSystem.writeFile = originalWrite;
      syncBuiltinESMExports();
    }
    assert.ok(failed.error);
    assert.equal(await readFile(hooksPath, 'utf8'), original, 'Hooks require saved policy and ownership before registration');
    assert.equal(failed.changed, failedFile === 'codex-context-policy.json.');
    assert.equal(failed.files.length, failed.changed ? 1 : 0);
    assert.equal((await updateContextPolicyInstall(operation)).error, null);
    assert.equal((await updateContextPolicyInstall(operation)).changed, false);
    assert.equal((await updateContextPolicyInstall({ ...operation, action: 'remove' })).error, null);
    assert.deepEqual(JSON.parse(await readFile(hooksPath, 'utf8')), foreignHooks);
  }
});

// Revoked coverage must remove owned hooks, retaining ownership when the rewrite fails.
test('installation_reconciles_revoked_coverage_without_orphaning_hooks', async () => {
  const repoRoot = await createInstallTarget();
  const operation = { repo_root: repoRoot, source_root: sourceRoot, action: 'install', apply: true };
  const hooksPath = join(repoRoot, '.codex/hooks.json');
  assert.equal((await updateContextPolicyInstall(operation)).error, null);
  const original = await readFile(hooksPath, 'utf8');
  await writeFile(join(repoRoot, '.codex/codex-context-policy-coverage.json'), JSON.stringify({
    client_version: '0.159.2', events: { UserPromptSubmit: 'unverified' },
  }));
  const originalWrite = installFileSystem.writeFile;
  let failed;
  try {
    installFileSystem.writeFile = async (path, ...args) => {
      if (String(path).includes('hooks.json.') && String(path).endsWith('.tmp')) throw new Error('Synthetic hooks disk failure');
      return originalWrite(path, ...args);
    };
    syncBuiltinESMExports();
    failed = await updateContextPolicyInstall(operation);
  } finally { installFileSystem.writeFile = originalWrite; syncBuiltinESMExports(); }
  assert.ok(failed.error, 'Revoked registration must attempt removal instead of reporting unchanged');
  assert.equal(await readFile(hooksPath, 'utf8'), original);
  assert.equal((await updateContextPolicyInstall({ ...operation, action: 'remove' })).error, null);
  assert.deepEqual(JSON.parse(await readFile(hooksPath, 'utf8')), foreignHooks);
  await writeFile(join(repoRoot, '.codex/codex-context-policy-coverage.json'), JSON.stringify({
    client_version: '0.159.2', events: { UserPromptSubmit: 'supported' },
  }));
  assert.equal((await updateContextPolicyInstall(operation)).error, null);
  await writeFile(join(repoRoot, '.codex/codex-context-policy-coverage.json'), JSON.stringify({ events: {} }));
  try {
    installFileSystem.writeFile = async (path, data, ...args) => {
      if (String(path).includes('codex-context-policy-install.json.') && String(path).endsWith('.tmp') &&
          JSON.parse(data).owned_groups.length === 0) throw new Error('Synthetic receipt compaction failure');
      return originalWrite(path, data, ...args);
    };
    syncBuiltinESMExports();
    failed = await updateContextPolicyInstall(operation);
  } finally { installFileSystem.writeFile = originalWrite; syncBuiltinESMExports(); }
  assert.ok(failed.error);
  assert.equal(failed.changed, true);
  assert.deepEqual(failed.files, [await realpath(hooksPath)], 'A failed receipt compaction must report the successful hook withdrawal');
  assert.deepEqual(JSON.parse(await readFile(hooksPath, 'utf8')), foreignHooks);
  assert.equal(JSON.parse(await readFile(join(repoRoot, '.codex/codex-context-policy-install.json'), 'utf8')).owned_groups.length, 1);
  const withdrawn = await updateContextPolicyInstall(operation);
  assert.equal(withdrawn.error, null);
  assert.equal(withdrawn.changed, true);
  assert.deepEqual(JSON.parse(await readFile(hooksPath, 'utf8')), foreignHooks);
  assert.equal((await updateContextPolicyInstall(operation)).changed, false);
  const receipt = JSON.parse(await readFile(join(repoRoot, '.codex/codex-context-policy-install.json'), 'utf8'));
  assert.deepEqual(receipt.owned_groups, [], 'Successful withdrawal must release ownership of the removed definitions');
  const foreignReadded = structuredClone(foreignHooks);
  foreignReadded.hooks.UserPromptSubmit.push(JSON.parse(original).hooks.UserPromptSubmit[1]);
  await writeFile(hooksPath, JSON.stringify(foreignReadded));
  assert.equal((await updateContextPolicyInstall(operation)).changed, false);
  assert.deepEqual(JSON.parse(await readFile(hooksPath, 'utf8')), foreignReadded);
  assert.equal((await updateContextPolicyInstall({ ...operation, action: 'remove' })).error, null);
  assert.deepEqual(JSON.parse(await readFile(hooksPath, 'utf8')), foreignReadded);
});

// Ownership receipts must permit removal after a separately installed source directory moves.
test('owned_installation_can_be_removed_when_source_is_missing', async () => {
  const copiedSource = await realpath(await mkdtemp(join(temporaryRoot, 'context-missing-source-')));
  for (const directory of ['src', 'config']) await mkdir(join(copiedSource, directory));
  for (const path of ['src/codex-context-policy.mjs', 'config/hooks.template.json', 'config/context-policy.template.json']) {
    await copyFile(join(sourceRoot, path), join(copiedSource, path));
  }
  const repoRoot = await createInstallTarget();
  const operation = { repo_root: repoRoot, source_root: copiedSource, action: 'install', apply: true };
  assert.equal((await updateContextPolicyInstall(operation)).error, null);
  await rename(copiedSource, copiedSource + '-moved');
  assert.equal((await updateContextPolicyInstall({ ...operation, action: 'remove' })).error, null);
  assert.deepEqual(JSON.parse(await readFile(join(repoRoot, '.codex/hooks.json'), 'utf8')), foreignHooks);
  assert.equal(await access(join(repoRoot, '.codex/codex-context-policy-install.json')).then(() => true, () => false), false);
});

// Malformed configuration must never leak its contents through public CLI diagnostics.
test('malformed_install_json_does_not_export_source_content', async () => {
  const repoRoot = await createInstallTarget();
  const secret = 'SYNTHETIC_PRIVATE_CONFIGURATION_VALUE';
  await writeFile(join(repoRoot, '.codex/hooks.json'), secret);
  const child = spawnSync(process.execPath, [resolve('scripts/manage-context-policy.mjs'), 'install',
    '--repo', repoRoot, '--source', sourceRoot, '--apply'], { encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.equal(child.stdout.includes('SYNTHETI'), false);
  assert.equal(child.stderr.includes('SYNTHETI'), false);
  assert.equal(await readFile(join(repoRoot, '.codex/hooks.json'), 'utf8'), secret);
});

// A held installation lock must preserve both existing hooks and another writer's lock.
test('busy_installation_preserves_foreign_lock_and_files', async () => {
  const repoRoot = await createInstallTarget();
  const hooksPath = join(repoRoot, '.codex/hooks.json');
  const lockPath = join(repoRoot, '.codex/.codex-context-policy-install.lock');
  const original = await readFile(hooksPath, 'utf8');
  await writeFile(lockPath, 'another installation');
  const result = await updateContextPolicyInstall({ repo_root: repoRoot, source_root: sourceRoot, action: 'install', apply: true });
  assert.ok(result.error);
  assert.ok(result.error.includes(lockPath), 'Busy diagnostics must identify the lock for verified manual recovery');
  assert.equal(result.changed, false);
  assert.equal(await readFile(hooksPath, 'utf8'), original);
  assert.equal(await readFile(lockPath, 'utf8'), 'another installation');
  for (const file of ['codex-context-policy.json', 'codex-context-policy-install.json']) {
    assert.equal(await access(join(repoRoot, '.codex', file)).then(() => true, () => false), false);
  }
});

// Shell-safe paths must survive JavaScript replacement syntax and retain existing modes.
test('installation_preserves_literal_source_paths_and_file_modes', async () => {
  const copiedSource = await mkdtemp(join(temporaryRoot, 'context-source #\n$& $\' $` $$-'));
  for (const directory of ['src', 'config']) await mkdir(join(copiedSource, directory));
  for (const path of ['src/codex-context-policy.mjs', 'config/hooks.template.json', 'config/context-policy.template.json']) {
    await copyFile(join(sourceRoot, path), join(copiedSource, path));
  }
  const repoRoot = await createInstallTarget();
  const hooksPath = join(repoRoot, '.codex/hooks.json');
  await chmod(hooksPath, 0o640);
  const operation = { repo_root: repoRoot, source_root: copiedSource, action: 'install', apply: true };
  assert.equal((await updateContextPolicyInstall(operation)).error, null);
  const installed = JSON.parse(await readFile(hooksPath, 'utf8'));
  const command = installed.hooks.UserPromptSubmit[1].hooks[0].command;
  const child = spawnSync('/bin/sh', ['-c', command], { input: JSON.stringify({ cwd: repoRoot,
    hook_event_name: 'UserPromptSubmit', session_id: 'source-path-test' }), encoding: 'utf8' });
  assert.equal(child.status, 0, 'The installed command must execute the literal source path');
  assert.equal((await updateContextPolicyInstall({ ...operation, action: 'remove' })).error, null);
  const priorUmask = process.umask(0o077);
  try {
    assert.equal((await updateContextPolicyInstall(operation)).error, null);
    assert.equal((await lstat(hooksPath)).mode & 0o777, 0o640, 'The caller umask must not strip existing file permissions');
  } finally { process.umask(priorUmask); }
});

test('invalid_configuration_is_off_and_malformed_hooks_are_preserved', async () => {
  const repoRoot = await createInstallTarget();
  const configPath = join(repoRoot, '.codex/codex-context-policy.json');
  for (const text of ['not json', 'null', '{}', '{"mode":"enforce","jev_enabled":"yes"}', '{"mode":"bad","jev_enabled":true}',
    JSON.stringify({ mode: 'enforce', jev_enabled: true, padding: 'x'.repeat(32001) })]) {
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
  const outside = await mkdtemp(join(temporaryRoot, 'context-outside-'));
  const maliciousRoot = await mkdtemp(join(temporaryRoot, 'context-symlink-'));
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

// Split UTF-8 must retain cwd identity and the valid input byte budget at both CLI boundaries.
test('hook_stdin_preserves_split_utf8_characters', async () => {
  const repoRoot = await realpath(await mkdtemp(join(temporaryRoot, 'context-unicode-é-')));
  await mkdir(join(repoRoot, '.codex'));
  const input = { cwd: repoRoot, session_id: 'unicode-session', hook_event_name: 'UserPromptSubmit', prompt: 'é' };
  const run = (program, args, value) => new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [program, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.stdin.on('error', reject);
    child.on('close', status => resolveRun({ status, stdout, stderr }));
    const bytes = Buffer.from(JSON.stringify(value));
    const split = bytes.indexOf(Buffer.from('é')) + 1;
    child.stdin.write(bytes.subarray(0, split));
    setTimeout(() => child.stdin.end(bytes.subarray(split)), 250);
  });
  const probe = await run(resolve('tests/context-hook-probe.mjs'), [repoRoot, 'unicode-probe-marker'], input);
  assert.equal(probe.status, 0);
  assert.match(probe.stdout, /unicode-probe-marker/);
  assert.equal(probe.stderr, '');
  const padded = { ...input, prompt: input.prompt + 'x'.repeat(999999 - Buffer.byteLength(JSON.stringify(input))) };
  const policy = await run(resolve('src/codex-context-policy.mjs'), ['hook'], padded);
  assert.equal(policy.status, 0);
  assert.equal(policy.stdout, '');
  assert.equal(policy.stderr, '', 'A valid input below the byte limit must not be rejected after split decoding');
});
