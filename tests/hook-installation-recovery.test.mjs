import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { updateContextPolicyInstall } from '../scripts/manage-context-policy.mjs';
import { materializePilotFixture } from '../src/pilot-evaluation.mjs';

const sourceRoot = resolve('.');
const temporaryRoot = await fs.mkdtemp(join(tmpdir(), 'context-recovery-tests-'));
after(() => assert.equal(spawnSync('trash', [temporaryRoot]).status, 0));
const gitEnvironment = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (root, args) => spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'init.templateDir=', ...args], {
  cwd: root, env: gitEnvironment, encoding: 'utf8',
});

async function createRecoveryTarget(gitRepository = false) {
  const root = await fs.realpath(await fs.mkdtemp(join(temporaryRoot, 'target-')));
  if (gitRepository) await materializePilotFixture(root);
  await fs.mkdir(join(root, '.codex'));
  await fs.writeFile(join(root, '.codex/codex-context-policy-coverage.json'), JSON.stringify({
    client_version: '0.159.2', events: { UserPromptSubmit: 'supported' },
  }));
  return root;
}

test('missing_source_removal_accepts_recorded_alias_only', async () => {
  const copiedSource = await fs.mkdtemp(join(temporaryRoot, 'source-'));
  for (const directory of ['src', 'config']) await fs.mkdir(join(copiedSource, directory));
  for (const path of ['src/codex-context-policy.mjs', 'config/hooks.template.json', 'config/context-policy.template.json']) {
    await fs.copyFile(join(sourceRoot, path), join(copiedSource, path));
  }
  const alias = copiedSource + '-alias';
  await fs.symlink(copiedSource, alias);
  const repoRoot = await createRecoveryTarget();
  const operation = { repo_root: repoRoot, source_root: alias, action: 'install', apply: true };
  assert.equal((await updateContextPolicyInstall(operation)).error, null);
  await fs.rename(copiedSource, copiedSource + '-moved');
  assert.ok((await updateContextPolicyInstall({ ...operation, action: 'remove', source_root: alias + '-unrelated' })).error);
  assert.equal((await updateContextPolicyInstall({ ...operation, action: 'remove' })).error, null);
  assert.equal(await fs.access(join(repoRoot, '.codex/hooks.json')).then(() => true, () => false), false);
});

test('pending_withdrawal_cannot_delete_another_worktree_registration', async () => {
  const primary = await createRecoveryTarget(true);
  const linked = join(temporaryRoot, 'linked');
  assert.equal(git(primary, ['worktree', 'add', '--detach', linked, 'HEAD']).status, 0);
  await fs.mkdir(join(linked, '.codex'));
  await fs.copyFile(join(primary, '.codex/codex-context-policy-coverage.json'), join(linked, '.codex/codex-context-policy-coverage.json'));
  const operationA = { repo_root: linked, source_root: sourceRoot, action: 'install', apply: true };
  const operationB = { ...operationA, repo_root: primary };
  assert.equal((await updateContextPolicyInstall(operationA)).error, null);
  await fs.writeFile(join(linked, '.codex/codex-context-policy-coverage.json'), '{"events":{}}');
  const originalWrite = fs.writeFile;
  try {
    fs.writeFile = async (path, data, ...args) => {
      if (String(path).includes('codex-context-policy-install.json.') && String(path).endsWith('.tmp') &&
          JSON.parse(data).owned_groups.length === 0) throw new Error('Synthetic pending compaction failure');
      return originalWrite(path, data, ...args);
    };
    syncBuiltinESMExports();
    assert.ok((await updateContextPolicyInstall(operationA)).error);
  } finally { fs.writeFile = originalWrite; syncBuiltinESMExports(); }
  assert.equal((await updateContextPolicyInstall(operationB)).error, null);
  const hooksPath = join(primary, '.codex/hooks.json');
  const registrationB = await fs.readFile(hooksPath, 'utf8');
  assert.equal((await updateContextPolicyInstall(operationA)).error, null);
  assert.equal(await fs.readFile(hooksPath, 'utf8'), registrationB);
  assert.equal((await updateContextPolicyInstall({ ...operationA, action: 'remove' })).error, null);
  assert.equal(await fs.readFile(hooksPath, 'utf8'), registrationB, 'A stale receipt must preserve B ownership');
  assert.equal((await updateContextPolicyInstall({ ...operationB, action: 'remove' })).error, null);
  assert.deepEqual(JSON.parse(await fs.readFile(hooksPath, 'utf8')), { hooks: {} });
});

test('removal_preserves_invalid_or_external_policy_without_blocking_withdrawal', async () => {
  for (const variant of ['malformed', 'symlink', 'directory']) {
    const root = await createRecoveryTarget();
    const operation = { repo_root: root, source_root: sourceRoot, action: 'install', apply: true };
    assert.equal((await updateContextPolicyInstall(operation)).error, null);
    const policy = join(root, '.codex/codex-context-policy.json');
    if (variant === 'malformed') await fs.writeFile(policy, 'PRIVATE_INVALID_POLICY');
    else {
      await fs.unlink(policy);
      if (variant === 'directory') await fs.mkdir(policy);
      else {
        const external = join(temporaryRoot, 'external-policy.json');
        await fs.writeFile(external, 'PRIVATE_EXTERNAL_POLICY');
        await fs.symlink(external, policy);
      }
    }
    assert.equal((await updateContextPolicyInstall({ ...operation, action: 'remove' })).error, null, variant);
    assert.equal(await fs.access(join(root, '.codex/hooks.json')).then(() => true, () => false), false);
    assert.equal(await fs.access(policy).then(() => true, () => false), true);
  }
});

test('modified_owned_definition_is_preserved_and_exact_foreign_copy_survives', async () => {
  const root = await createRecoveryTarget();
  const operation = { repo_root: root, source_root: sourceRoot, action: 'install', apply: true };
  assert.equal((await updateContextPolicyInstall(operation)).error, null);
  const hooksPath = join(root, '.codex/hooks.json');
  const original = await fs.readFile(hooksPath, 'utf8');
  const modified = JSON.parse(original);
  modified.hooks.UserPromptSubmit[0].hooks[0].timeout = 2;
  await fs.writeFile(hooksPath, JSON.stringify(modified));
  for (const action of ['install', 'remove']) {
    const result = await updateContextPolicyInstall({ ...operation, action });
    assert.ok(result.error, 'Modified ownership requires explicit reconciliation');
    assert.equal(result.changed, false);
    assert.deepEqual(JSON.parse(await fs.readFile(hooksPath, 'utf8')), modified);
    assert.equal(await fs.access(join(root, '.codex/codex-context-policy-install.json')).then(() => true, () => false), true);
  }
  const copied = JSON.parse(original);
  copied.hooks.UserPromptSubmit.push(structuredClone(copied.hooks.UserPromptSubmit[0]));
  await fs.writeFile(hooksPath, JSON.stringify(copied));
  assert.equal((await updateContextPolicyInstall({ ...operation, action: 'remove' })).error, null);
  assert.deepEqual(JSON.parse(await fs.readFile(hooksPath, 'utf8')).hooks.UserPromptSubmit, [copied.hooks.UserPromptSubmit[1]]);
});

test('edited_owned_commands_and_moved_events_preserve_receipt_until_reconciled', async () => {
  for (const modification of ['command', 'event', 'comment']) {
    const root = await createRecoveryTarget();
    const operation = { repo_root: root, source_root: sourceRoot, action: 'install', apply: true };
    assert.equal((await updateContextPolicyInstall(operation)).error, null);
    const hooksPath = join(root, '.codex/hooks.json');
    const receiptPath = join(root, '.codex/codex-context-policy-install.json');
    const originalReceipt = await fs.readFile(receiptPath, 'utf8');
    const hooks = JSON.parse(await fs.readFile(hooksPath, 'utf8'));
    const group = hooks.hooks.UserPromptSubmit[0];
    if (modification === 'command') group.hooks[0].command = group.hooks[0].command.replace(' hook #', ' hook EXTRA #');
    else if (modification === 'comment') group.hooks[0].command += ' edited comment';
    else { hooks.hooks.SessionStart = [group]; delete hooks.hooks.UserPromptSubmit; }
    const modifiedBytes = JSON.stringify(hooks);
    await fs.writeFile(hooksPath, modifiedBytes);
    for (const action of ['install', 'remove']) {
      const result = await updateContextPolicyInstall({ ...operation, action });
      assert.ok(result.error, modification + ': edited ownership cannot be silently abandoned');
      assert.equal(result.changed, false);
      assert.equal(await fs.readFile(hooksPath, 'utf8'), modifiedBytes);
      assert.equal(await fs.readFile(receiptPath, 'utf8'), originalReceipt);
      assert.equal(await fs.access(join(root, '.codex/codex-context-policy.json')).then(() => true, () => false), true);
    }
  }
});

test('symlinked_cli_entrypoints_execute_and_emit_their_protocol', async t => {
  const alias = join(temporaryRoot, 'source-alias');
  await fs.symlink(sourceRoot, alias);
  const root = await createRecoveryTarget();
  for (const [program, args, status, output] of [
    ['scripts/manage-context-policy.mjs', ['install', '--repo', root, '--source', alias], 0, /"changed":\s*true/],
    ['src/pilot-evaluation.mjs', ['corpus', '--tasks', resolve('evaluation/tasks.jsonl')], 0, /"valid":true/],
    ['src/codex-context-policy.mjs', ['unsupported-operation'], 1, /expected operation hook/],
  ]) await t.test(program, () => {
    const child = spawnSync(process.execPath, [join(alias, program), ...args], { encoding: 'utf8' });
    assert.equal(child.status, status);
    assert.match(child.stdout + child.stderr, output);
  });
});

test('imported_policy_modules_ignore_unrelated_process_arguments', async t => {
  for (const program of ['scripts/manage-context-policy.mjs', 'src/pilot-evaluation.mjs', 'src/codex-context-policy.mjs']) {
    await t.test(program, () => {
      const child = spawnSync(process.execPath, ['--input-type=module', '-e',
        'const program = process.argv[1]; process.argv[1] = "missing-unrelated-argument"; await import(program);', resolve(program)], { encoding: 'utf8' });
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stdout, '');
    });
  }
});

test('linked_worktree_test_ignores_ambient_git_hooks', async () => {
  const ambient = join(temporaryRoot, 'ambient');
  await fs.mkdir(join(ambient, 'git'), { recursive: true });
  const hooks = join(ambient, 'hooks');
  await fs.mkdir(hooks);
  await fs.writeFile(join(hooks, 'post-checkout'), '#!/bin/sh\nexit 41\n', { mode: 0o700 });
  await fs.writeFile(join(ambient, 'git/config'), '[core]\n  hooksPath = ' + hooks + '\n');
  const environment = { ...process.env, XDG_CONFIG_HOME: ambient };
  delete environment.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, ['--test', '--test-name-pattern=^linked_worktree_install_uses_primary_hook_registration$',
    resolve('tests/hook-installation.test.mjs')], { env: environment, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stdout + child.stderr);
});

test('git_subdirectory_targets_are_rejected_without_writes', async () => {
  const root = await createRecoveryTarget(true);
  const result = await updateContextPolicyInstall({ repo_root: join(root, 'src'), source_root: sourceRoot, action: 'install', apply: true });
  assert.ok(result.error);
  assert.equal(result.changed, false);
  assert.equal(await fs.access(join(root, 'src/.codex')).then(() => true, () => false), false);
});

test('lock_release_failures_preserve_structured_applied_result', async () => {
  for (const failure of ['unlink', 'close']) {
    const root = await createRecoveryTarget();
    const originalUnlink = fs.unlink;
    const originalOpen = fs.open;
    let unlinkAttempted = false;
    let result;
    try {
      fs.unlink = async path => {
        if (String(path).endsWith('.codex-context-policy-install.lock')) {
          unlinkAttempted = true;
          if (failure === 'unlink') throw new Error('Synthetic lock release failure');
        }
        return originalUnlink(path);
      };
      fs.open = async (...args) => {
        const handle = await originalOpen(...args);
        if (failure === 'close' && String(args[0]).endsWith('.codex-context-policy-install.lock')) {
          const originalClose = handle.close.bind(handle);
          handle.close = async () => { await originalClose(); throw new Error('Synthetic lock close failure'); };
        }
        return handle;
      };
      syncBuiltinESMExports();
      await assert.doesNotReject(async () => {
        result = await updateContextPolicyInstall({ repo_root: root, source_root: sourceRoot, action: 'install', apply: true });
      });
    } finally { fs.unlink = originalUnlink; fs.open = originalOpen; syncBuiltinESMExports(); }
    assert.equal(unlinkAttempted, true);
    assert.equal(result.changed, true);
    assert.equal(result.files.length, 3);
    assert.match(result.error, /lock/i);
  }
});

test('installation_identity_and_git_discovery_boundaries_fail_closed', async () => {
  const root = await createRecoveryTarget(true);
  const operation = { repo_root: root, source_root: sourceRoot, action: 'install', apply: true };
  assert.equal((await updateContextPolicyInstall(operation)).error, null);
  const receiptPath = join(root, '.codex/codex-context-policy-install.json');
  const original = await fs.readFile(receiptPath, 'utf8');
  for (const alteration of [{ version: 2 }, { source_root: root }, { hooks_root: root + '-foreign' }]) {
    await fs.writeFile(receiptPath, JSON.stringify({ ...JSON.parse(original), ...alteration }));
    const result = await updateContextPolicyInstall({ ...operation, action: 'remove' });
    assert.ok(result.error);
    assert.equal(result.changed, false);
  }
  await fs.writeFile(receiptPath, original);
  const legacyReceipt = JSON.parse(original);
  delete legacyReceipt.source_path;
  const legacyGroup = legacyReceipt.owned_groups[0].group;
  legacyGroup.hooks[0].command = legacyGroup.hooks[0].command.replace(/ # codex-context-policy-owner=[a-f0-9]{64}$/, '');
  await fs.writeFile(receiptPath, JSON.stringify(legacyReceipt));
  await fs.writeFile(join(root, '.codex/hooks.json'), JSON.stringify({ hooks: { UserPromptSubmit: [legacyGroup] } }));
  assert.equal((await updateContextPolicyInstall(operation)).error, null);
  const upgraded = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  assert.equal(upgraded.owned_groups.length, 1);
  assert.match(upgraded.owned_groups[0].group.hooks[0].command, / # codex-context-policy-owner=[a-f0-9]{64}$/);
  assert.equal((await updateContextPolicyInstall(operation)).changed, false);
  const plain = await createRecoveryTarget();
  await fs.symlink(join(root, '.git'), join(plain, '.git'));
  assert.ok((await updateContextPolicyInstall({ ...operation, repo_root: plain })).error);
  const linked = join(temporaryRoot, 'discovery-linked');
  assert.equal(git(root, ['worktree', 'add', '--detach', linked, 'HEAD']).status, 0);
  await fs.mkdir(join(linked, '.codex'));
  const cli = spawnSync(process.execPath, [resolve('scripts/manage-context-policy.mjs'), 'install', '--repo', linked, '--source', sourceRoot], {
    env: { ...process.env, GIT_DIR: join(plain, '.git'), GIT_WORK_TREE: plain }, encoding: 'utf8',
  });
  assert.equal(cli.status, 0);
  assert.equal(JSON.parse(cli.stdout).error, null);
  await fs.rename(root, root + '-moved');
  assert.ok((await updateContextPolicyInstall({ ...operation, repo_root: linked })).error);
});
