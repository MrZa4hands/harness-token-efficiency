import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { updateContextPolicyInstall } from '../scripts/manage-context-policy.mjs';
import { readContextPolicyConfig, readContextSourceVersions } from '../src/codex-context-policy.mjs';
import { comparePilotRuns } from '../src/context-promotion.mjs';
import { createContextPilotRuns } from './context-pilot-runs.fixture.mjs';

const temporary = await realpath(await mkdtemp(join(tmpdir(), 'context-mode-boundaries-')));
after(() => assert.equal(spawnSync('trash', [temporary]).status, 0));
const manager = resolve('scripts/manage-context-policy.mjs');

// Pretty serialization must not turn a readable compact policy into a disabled, uneditable policy.
test('mode_rejects_canonical_policy_expansion_without_replacing_bytes', async () => {
  const root = await mkdtemp(join(temporary, 'mode-')); const directory = join(root, '.codex');
  await mkdir(directory, { mode: 0o700 }); const path = join(directory, 'codex-context-policy.json');
  const text = JSON.stringify({ mode: 'shadow', jev_enabled: false, padding: Array(4500).fill(null) });
  assert.ok(Buffer.byteLength(text) < 32000);
  await writeFile(path, text, { mode: 0o600 });
  const child = spawnSync(process.execPath, [manager, 'mode', 'enforce', '--repo', root], { encoding: 'utf8', timeout: 3000 });
  assert.equal(child.status, 1, 'Unusable canonical output must be rejected before changing the policy');
  assert.equal(JSON.parse(child.stdout).changed, false);
  assert.equal(await readFile(path, 'utf8'), text);
  assert.equal((await readContextPolicyConfig(root)).mode, 'shadow');
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
});

// Promotion must not publish its report before discovering that the resulting policy is unreadable.
test('promotion_rejects_canonical_policy_expansion_before_any_write', async () => {
  const root = await mkdtemp(join(temporary, 'promotion-')); const directory = join(root, '.codex');
  assert.equal((await updateContextPolicyInstall({ repo_root: root, source_root: resolve('.'), action: 'install', apply: true })).error, null);
  const config = { mode: 'shadow', jev_enabled: false, padding: Array(4500).fill(null) };
  const text = JSON.stringify(config); const path = join(directory, 'codex-context-policy.json');
  await writeFile(path, text, { mode: 0o600 });
  const input = { client_version: '0.159.2', model: 'fixture-main-model', reasoning_effort: 'medium' };
  const questions = JSON.parse(await readFile(resolve('config/jev-questions.json'), 'utf8'));
  const versions = await readContextSourceVersions(resolve('.'), { input, config, questions });
  const report = comparePilotRuns(createContextPilotRuns(versions));
  assert.ok(report.promotions.some(row => row.family === 'code_context' && row.variant === 'deterministic'));
  await writeFile(join(directory, 'codex-context-policy-coverage.json'), JSON.stringify({ client_version: input.client_version,
    events: { UserPromptSubmit: 'supported' } }), { mode: 0o600 });
  const reportPath = join(root, 'qualified-report.json'); await writeFile(reportPath, JSON.stringify(report), { mode: 0o600 });
  const child = spawnSync(process.execPath, [manager, 'promote', '--repo', root, '--report', reportPath,
    '--family', 'code_context', '--variant', 'deterministic', '--apply'], { encoding: 'utf8', timeout: 3000 });
  assert.equal(child.status, 1, 'An oversized resulting policy must reject the whole promotion');
  assert.equal(JSON.parse(child.stdout).changed, false);
  assert.equal(await readFile(path, 'utf8'), text);
  assert.equal(await lstat(join(directory, 'codex-context-promotion-code_context-deterministic.json')).catch(() => null), null);
  assert.equal((await readContextPolicyConfig(root)).mode, 'shadow');
});

// Persisted qualification must distinguish actual automatic context consumers from evidence-only families.
test('promotion_discloses_qualification_only_families_and_unchanged_global_cap', async () => {
  const root = await mkdtemp(join(temporary, 'disclosure-')); const directory = join(root, '.codex');
  assert.equal((await updateContextPolicyInstall({ repo_root: root, source_root: resolve('.'), action: 'install', apply: true })).error, null);
  const config = { mode: 'shadow', jev_enabled: false }; const path = join(directory, 'codex-context-policy.json');
  await writeFile(path, JSON.stringify(config), { mode: 0o600 });
  const input = { client_version: '0.159.2', model: 'fixture-main-model', reasoning_effort: 'medium' };
  const questions = JSON.parse(await readFile(resolve('config/jev-questions.json'), 'utf8'));
  const versions = await readContextSourceVersions(resolve('.'), { input, config, questions });
  await writeFile(join(directory, 'codex-context-policy-coverage.json'), JSON.stringify({ client_version: input.client_version,
    events: { UserPromptSubmit: 'supported' } }), { mode: 0o600 });
  const reportPath = join(root, 'qualified-report.json');
  for (const [family, automatic] of [['code_context', true], ['code_review_context', true], ['documentation_context', true],
    ['get_repository_changes', false], ['read_context', false], ['run_project_checks', false], ['rewrite_simple_command', false]]) {
    const report = comparePilotRuns(createContextPilotRuns(versions).map(row => ({ ...row, family })));
    await writeFile(reportPath, JSON.stringify(report), { mode: 0o600 });
    for (const extra of [[], ['--apply']]) {
      const child = spawnSync(process.execPath, [manager, 'promote', '--repo', root, '--report', reportPath,
        '--family', family, '--variant', 'deterministic', ...extra], { encoding: 'utf8', timeout: 3000 });
      assert.equal(child.status, 0, child.stdout + child.stderr);
      assert.deepEqual(JSON.parse(child.stdout).activation, { automatic_consumer_available: automatic,
        scope: automatic ? 'automatic-context' : 'qualification-only', global_mode: 'shadow' });
      assert.equal((await readContextPolicyConfig(root)).mode, 'shadow', 'Qualification must preserve the global mode cap');
    }
    const installed = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(installed.operations[family], 'enforce');
    assert.match(installed.promotions[family].deterministic.report_sha256, /^[a-f0-9]{64}$/);
  }
});
