import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, realpath, readFile, writeFile, readdir } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readContextSourceVersions } from '../src/codex-context-policy.mjs';
import { comparePilotRuns, resolveContextPromotion } from '../src/context-promotion.mjs';
import { createContextPilotRuns } from './context-pilot-runs.fixture.mjs';
import { updateContextPolicyInstall } from '../scripts/manage-context-policy.mjs';

const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'context-policy-contract-')));
after(() => assert.equal(spawnSync('trash', [temporaryRoot]).status, 0));
const gitEnvironment = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

// Trial and installation safety changes must not reuse qualification measured against different runtime behavior.
test('trial_and_install_source_changes_invalidate_measured_policy_qualification', async () => {
  const sourceRoot = join(temporaryRoot, 'copied-source');
  await cp(resolve('src'), join(sourceRoot, 'src'), { recursive: true });
  const options = { input: { client_version: '0.159.2', model: 'fixture-model', reasoning_effort: 'high' },
    config: { mode: 'enforce', jev_enabled: false, operations: { code_context: 'enforce' } },
    questions: JSON.parse(await readFile(resolve('config/jev-questions.json'), 'utf8')) };
  const versions = await readContextSourceVersions(sourceRoot, options);
  const report = comparePilotRuns(createContextPilotRuns(versions));
  assert.equal(resolveContextPromotion(options.config, 'code_context', versions, report), 'deterministic');
  for (const name of ['context-trial.mjs', 'context-install-lock.mjs']) {
    const path = join(sourceRoot, 'src', name); const original = await readFile(path, 'utf8');
    await writeFile(path, original + '\n// Changed native runtime behavior.\n');
    const changed = await readContextSourceVersions(sourceRoot, options);
    assert.notEqual(changed.policy_hash, versions.policy_hash, 'Runtime source belongs to the measured policy fingerprint: ' + name);
    assert.equal(resolveContextPromotion(options.config, 'code_context', changed, report), 'shadow');
    await writeFile(path, original);
  }
});

// Component off suppresses automatic composite work while explicit evidence recovery remains authorized.
test('automatic_review_respects_disabled_components_and_manual_recovery', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'repository-'));
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.excludesFile=/dev/null',
    '-c', 'core.attributesFile=/dev/null', ...args], { cwd: root, env: gitEnvironment });
  git(['-c', 'init.templateDir=', 'init', '--initial-branch=fixture-main']);
  await mkdir(join(root, 'src'));
  for (const name of ['a', 'b', 'c']) await writeFile(join(root, 'src', name + '.mjs'), 'export const value = 1;\n');
  git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture: review components']);
  await mkdir(join(root, '.git/info')); await writeFile(join(root, '.git/info/exclude'), '.codex/\n');
  await mkdir(join(root, '.codex'));
  await writeFile(join(root, '.codex/codex-context-policy-coverage.json'),
    JSON.stringify({ client_version: '0.159.2', events: { UserPromptSubmit: 'supported' } }));
  assert.equal((await updateContextPolicyInstall({ repo_root: root, source_root: resolve('.'), action: 'install', apply: true })).error, null);
  for (const name of ['a', 'b']) await writeFile(join(root, 'src', name + '.mjs'), 'export const value = ' + JSON.stringify(name.repeat(4000)) + ';\n');
  await writeFile(join(root, 'src/c.mjs'), 'export const value = 2;\n');
  const isolatedHome = join(temporaryRoot, 'isolated-home'); await mkdir(isolatedHome);
  const bootstrap = join(temporaryRoot, 'isolated-home.mjs');
  await writeFile(bootstrap, "import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module';\n" +
    'os.homedir = () => ' + JSON.stringify(isolatedHome) + '; syncBuiltinESMExports();\n');
  const cli = (operation, input) => spawnSync(process.execPath, ['--import', bootstrap, resolve('src/codex-context-policy.mjs'), operation],
    { input: JSON.stringify(input), encoding: 'utf8', env: gitEnvironment, timeout: 3500 });
  const hash = value => createHash('sha256').update(value).digest('hex');
  const stateDir = join(isolatedHome, '.codex/codex-context-policy');
  const policyPath = join(root, '.codex/codex-context-policy.json');
  for (const disabled of [null, 'get_repository_changes', 'read_context']) {
    const session = 'component-' + (disabled ?? 'enabled');
    await writeFile(policyPath, JSON.stringify({ mode: 'shadow', jev_enabled: false,
      operations: disabled ? { [disabled]: 'off' } : {} }), { mode: 0o600 });
    const child = cli('hook', { cwd: root, session_id: session, turn_id: 'turn', hook_event_name: 'UserPromptSubmit',
      prompt: 'Review all changes.', permission_mode: 'read-only', client_version: '0.159.2', model: 'fixture-model', reasoning_effort: 'high' });
    assert.equal(child.status, 0, child.stderr); assert.equal(child.stderr, ''); assert.equal(child.stdout, '');
    const directory = join(stateDir, hash(root), hash(session));
    const names = (await readdir(directory)).filter(name => /^result-[a-f0-9]{64}\.json$/.test(name));
    const artifacts = await Promise.all(names.map(async name => JSON.parse(await readFile(join(directory, name), 'utf8'))));
    const selectionPrepared = artifacts.some(artifact => artifact.bundle.entries.some(entry => entry.kind !== 'change'));
    assert.equal(selectionPrepared, !disabled, 'Automatic review must abstain when its required component is off: ' + disabled);
    if (disabled === 'get_repository_changes') assert.equal(artifacts.length, 0, 'Disabled changes component must not prepare repository evidence');
    if (disabled === 'read_context') {
      await writeFile(policyPath, JSON.stringify({ mode: 'off', jev_enabled: false,
        operations: { get_repository_changes: 'off', read_context: 'off' } }));
      const changes = cli('get_repository_changes', { repo_root: root, session_id: session, state_dir: stateDir,
        scope: { kind: 'worktree' }, byte_limit: 2200 });
      assert.equal(changes.status, 0, changes.stderr);
      const page = JSON.parse(changes.stdout); assert.equal(page.status, 'ok'); assert.ok(page.next_cursor);
      const continued = cli('read_context', { repo_root: root, session_id: session, state_dir: stateDir,
        reference: page.full_result, cursor: page.next_cursor, byte_limit: 2200 });
      assert.equal(continued.status, 0, continued.stderr); assert.equal(JSON.parse(continued.stdout).status, 'ok');
    }
  }
});
