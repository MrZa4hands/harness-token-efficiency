import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { comparePilotRuns, resolveContextPromotion } from '../src/context-promotion.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readContextSourceVersions } from '../src/codex-context-policy.mjs';
import { updateContextPolicyInstall, promoteContextPolicy } from '../scripts/manage-context-policy.mjs';
import installFileSystem from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { readContextPolicyConfig } from '../src/codex-context-policy.mjs';
import { createContextPilotRuns } from './context-pilot-runs.fixture.mjs';

const versions = { client_version: '0.159.2', policy_hash: 'a'.repeat(64), questions_hash: 'b'.repeat(64),
  main_model: 'fixture-main-model', reasoning_effort: 'fixture-effort', jev_model: 'fixture-jev-model' };
function measuredRuns() {
  return createContextPilotRuns(versions);
}

// Trusting a summary, missing billing, unmatched tasks or worse quality would activate unproven savings.
test('context_promotion_recomputes_paired_evidence', () => {
  const runs = measuredRuns(); const report = comparePilotRuns(runs);
  assert.ok(report.promotions.some(promotion => promotion.family === 'code_context' && promotion.variant === 'deterministic'),
    'Exactly 20% paired total-token reduction with preserved quality/latency must qualify');
  assert.ok(!report.promotions.some(promotion => promotion.variant === 'hybrid'),
    'Equal hybrid totals do not establish incremental value over deterministic');
  const config = { mode: 'enforce', jev_enabled: false, operations: { code_context: 'enforce' } };
  assert.equal(resolveContextPromotion(config, 'code_context', versions, report), 'deterministic');
  for (const [name, mutate] of [
    ['missing usage', row => { row.codex_usage.available = false; }],
    ['wrong answer', row => { row.quality.correct = false; }],
    ['omitted evidence', row => { row.quality.evidence_complete = false; }],
    ['missing check', row => { row.quality.checks_complete = false; }],
    ['critical regression', row => { row.quality.critical_regression = true; }],
    ['unverified task coverage', row => { row.task_coverage_verified = false; }],
    ['string task coverage', row => { row.task_coverage_verified = 'false'; }],
    ['string native execution', row => { row.native_execution_verified = 'false'; }],
    ['string Codex availability', row => { row.codex_usage.available = 'false'; }],
    ['string Jev availability', row => { row.jev_usage.available = 'false'; }],
    ['semantic deterministic run', row => {
      row.codex_usage.input_tokens = 690; row.codex_usage.total_tokens = 790;
      row.jev_usage = { available: true, input_tokens: 5, output_tokens: 5, total_tokens: 10,
        requests: 1, models: [versions.jev_model] };
    }],
    ['unknown model', row => { row.versions.main_model = 'unverified'; }],
    ['prompt mismatch', row => { row.prompt_hash = 'c'.repeat(64); }],
    ['insufficient reduction', row => { row.codex_usage.input_tokens = 710; row.codex_usage.total_tokens = 810; }],
    ['increased median duration', row => { row.duration_ms = 1001; }],
  ]) {
    const changed = structuredClone(runs);
    for (const row of changed.filter(row => row.variant === 'deterministic')) mutate(row);
    assert.ok(!comparePilotRuns(changed).promotions.some(promotion => promotion.variant === 'deterministic'), name);
  }
  const missing = comparePilotRuns(runs.slice(1)); assert.equal(missing.promotions.length, 0, 'Every held-out task needs all three actual variants');
  assert.equal(resolveContextPromotion({ ...config, mode: 'shadow' }, 'code_context', versions, report), 'shadow');
  assert.equal(resolveContextPromotion({ ...config, mode: 'off' }, 'code_context', versions, report), 'off');
  assert.equal(resolveContextPromotion(config, 'code_context', { ...versions, policy_hash: 'd'.repeat(64) }, report), 'shadow');
  assert.equal(resolveContextPromotion(config, 'code_context', { ...versions, jev_model: 'changed', questions_hash: 'e'.repeat(64) }, report), 'deterministic',
    'Deterministic qualification is independent of Jev model/questions');
  const forgedSummary = { ...report, runs: runs.slice(1), promotions: report.promotions };
  assert.equal(resolveContextPromotion(config, 'code_context', versions, forgedSummary), 'shadow', 'Stored summary cannot grant activation');
  const mismatchedFamily = structuredClone(runs);
  for (const row of mismatchedFamily) {
    if (row.variant === 'deterministic') row.family = 'documentation_context';
    if (row.variant === 'hybrid') { row.codex_usage.input_tokens = 600; row.codex_usage.total_tokens = 700; }
  }
  assert.equal(comparePilotRuns(mismatchedFamily).promotions.length, 0,
    'Incremental hybrid value must compare the same deterministic family');
});

const temporaryRoot = await mkdtemp(join(tmpdir(), 'context-promotion-tests-'));
after(() => assert.equal(spawnSync('trash', [temporaryRoot]).status, 0));

// Mixed executed models cannot share one hybrid promotion fingerprint.
test('hybrid_promotion_requires_bound_actual_provider_models', () => {
  const runs = measuredRuns();
  for (const row of runs.filter(row => row.variant === 'hybrid')) {
    row.codex_usage.input_tokens = 590; row.codex_usage.total_tokens = 690;
    row.jev_usage = { available: true, input_tokens: 5, output_tokens: 5, total_tokens: 10,
      requests: 1, models: [versions.jev_model] };
  }
  assert.ok(comparePilotRuns(runs).promotions.some(item => item.variant === 'hybrid'));
  for (const models of [[versions.jev_model, 'changed-actual-model'], [versions.jev_model]]) {
    const changed = structuredClone(runs);
    for (const row of changed.filter(row => row.variant === 'hybrid')) {
      row.jev_usage.models = models;
      row.jev_usage.requests = models.length === 2 ? 2 : 0;
      if (row.jev_usage.requests === 0) Object.assign(row.jev_usage, { input_tokens: 0, output_tokens: 0, total_tokens: 0 });
    }
    assert.ok(!comparePilotRuns(changed).promotions.some(item => item.variant === 'hybrid'),
      'Every observed provider model must match the actual pin, and absent requests imply absent models');
  }
});

test('promotion_records_cannot_invalidate_their_own_source_version', async () => {
  const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
  const questions = JSON.parse(await readFile(new URL('../config/jev-questions.json', import.meta.url), 'utf8'));
  const input = { client_version: '0.159.2', model: 'fixture-main-model', reasoning_effort: 'medium' };
  const before = await readContextSourceVersions(sourceRoot, { input, questions, config: { mode: 'shadow', jev_enabled: false } });
  const after = await readContextSourceVersions(sourceRoot, { input, questions,
    config: { mode: 'enforce', jev_enabled: false, promotions: { code_context: { report_sha256: 'c'.repeat(64) } } } });
  assert.equal(after.policy_hash, before.policy_hash, 'Persisting a qualified promotion or changing mode cannot invalidate its source fingerprint');
  assert.equal(before.main_model, input.model); assert.equal(before.reasoning_effort, input.reasoning_effort);
  const unknown = await readContextSourceVersions(sourceRoot, { input: {}, questions, config: { mode: 'shadow', jev_enabled: false } });
  assert.equal(unknown.client_version, 'unverified'); assert.equal(unknown.main_model, 'unverified');
});
test('pilot_report_cli_recomputes_measured_runs', async () => {
  const path = join(temporaryRoot, 'private-runs.jsonl');
  await writeFile(path, measuredRuns().map(row => JSON.stringify(row)).join('\n') + '\n', { mode: 0o600 });
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('../src/pilot-evaluation.mjs', import.meta.url)),
    'report', '--runs', path, '--tasks', fileURLToPath(new URL('../evaluation/tasks.jsonl', import.meta.url))], { encoding: 'utf8', timeout: 3000 });
  assert.equal(child.status, 0, 'The report operation must compute eligibility from actual run data: ' + child.stderr);
  const report = JSON.parse(child.stdout);
  assert.ok(report.promotions.some(promotion => promotion.variant === 'deterministic'));
  assert.equal(report.runs.length, 180);
  const fifo = join(temporaryRoot, 'runs-fifo'); assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
  const blocked = spawnSync(process.execPath, [fileURLToPath(new URL('../src/pilot-evaluation.mjs', import.meta.url)),
    'report', '--runs', fifo, '--tasks', fileURLToPath(new URL('../evaluation/tasks.jsonl', import.meta.url))], { encoding: 'utf8', timeout: 1000 });
  assert.equal(blocked.status, 1, 'Run-report reads must reject a FIFO without waiting for a writer');
});

// A promotion command must persist only current owned qualified evidence; forged summaries cannot change mode/config.
test('promotion_cli_persists_only_qualified_current_reports', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'owned-install-')); const directory = join(root, '.codex');
  await mkdir(directory);
  const config = { mode: 'shadow', jev_enabled: false, operations: {} };
  const configPath = join(directory, 'codex-context-policy.json');
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  await writeFile(join(directory, 'codex-context-policy-coverage.json'), JSON.stringify({ client_version: '0.159.2', events: { UserPromptSubmit: 'supported' } }));
  const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
  assert.equal((await updateContextPolicyInstall({ repo_root: root, source_root: sourceRoot, action: 'install', apply: true })).error, null);
  const questions = JSON.parse(await readFile(new URL('../config/jev-questions.json', import.meta.url), 'utf8'));
  const currentVersions = await readContextSourceVersions(sourceRoot, { config, questions,
    input: { client_version: '0.159.2', model: 'fixture-main-model', reasoning_effort: 'medium' } });
  const runs = measuredRuns().map(row => ({ ...row, versions: currentVersions }));
  const report = comparePilotRuns(runs); const reportPath = join(temporaryRoot, 'qualified-report.json');
  await writeFile(reportPath, JSON.stringify(report), { mode: 0o600 });
  const invoke = (apply, variant = 'deterministic') => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/manage-context-policy.mjs', import.meta.url)),
    'promote', '--repo', root, '--report', reportPath, '--family', 'code_context', '--variant', variant, ...(apply ? ['--apply'] : [])],
  { encoding: 'utf8', timeout: 3000 });
  const before = await readFile(configPath, 'utf8');
  const preview = invoke(false); assert.equal(preview.status, 0, 'Qualified promotion must have a dry-run: ' + preview.stderr);
  assert.equal(await readFile(configPath, 'utf8'), before, 'Dry-run cannot change policy');
  const applied = invoke(true); assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  const updated = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(updated.mode, 'shadow', 'Qualification cannot raise the global mode cap');
  assert.equal(updated.operations.code_context, 'enforce');
  assert.match(updated.promotions.code_context.deterministic.report_sha256, /^[a-f0-9]{64}$/);
  const storedPath = join(directory, 'codex-context-promotion-code_context-deterministic.json');
  assert.equal((await lstat(storedPath)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(storedPath, 'utf8')).runs.length, 180);
  const qualifiedBytes = await readFile(configPath, 'utf8');
  await writeFile(reportPath, JSON.stringify({ ...report, runs: report.runs.slice(1) }));
  const forged = invoke(true); assert.equal(forged.status, 1);
  assert.equal(await readFile(configPath, 'utf8'), qualifiedBytes, 'Rejected report cannot alter any active configuration');
  const familyRuns = runs.map(row => structuredClone(row));
  for (const [index, row] of familyRuns.entries()) {
    if (index >= 60) {
      row.family = 'documentation_context';
      row.versions.main_model = 'second-fixture-model'; row.versions.reasoning_effort = 'high';
    }
  }
  const familyReport = comparePilotRuns(familyRuns);
  assert.ok(familyReport.promotions.some(item => item.family === 'documentation_context' && item.variant === 'deterministic'));
  await writeFile(reportPath, JSON.stringify(familyReport));
  const familyPreview = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/manage-context-policy.mjs', import.meta.url)),
    'promote', '--repo', root, '--report', reportPath, '--family', 'documentation_context', '--variant', 'deterministic'],
    { encoding: 'utf8', timeout: 3000 });
  assert.equal(familyPreview.status, 0, 'A family must use its own measured model/effort: ' + familyPreview.stdout + familyPreview.stderr);
  assert.equal(await readFile(configPath, 'utf8'), qualifiedBytes);
  // A better hybrid report cannot erase or prevent independent deterministic qualification.
  const enabled = { ...updated, mode: 'enforce', jev_enabled: true, jev_model: 'fixture-jev-model', jev_actual_model: 'fixture-jev-model' };
  await writeFile(configPath, JSON.stringify(enabled));
  const bothVersions = { ...currentVersions, jev_model: 'fixture-jev-model' };
  const bothRuns = createContextPilotRuns(bothVersions);
  for (const row of bothRuns.filter(row => row.variant === 'hybrid')) {
    row.codex_usage.input_tokens = 590; row.codex_usage.total_tokens = 690;
    row.jev_usage = { available: true, input_tokens: 5, output_tokens: 5, total_tokens: 10, requests: 1, models: ['fixture-jev-model'] };
  }
  const bothReport = comparePilotRuns(bothRuns);
  await writeFile(reportPath, JSON.stringify(bothReport));
  assert.equal(invoke(true, 'deterministic').status, 0, 'A qualifying hybrid cannot block saving its deterministic fallback');
  assert.equal(invoke(true, 'hybrid').status, 0);
  const bothConfig = await readContextPolicyConfig(root);
  assert.ok(bothConfig.promotions.code_context.deterministic);
  assert.ok(bothConfig.promotions.code_context.hybrid);
  await writeFile(configPath, JSON.stringify({ ...bothConfig, jev_enabled: false }));
  const withdrawn = await readContextPolicyConfig(root);
  const fallback = JSON.parse(await readFile(storedPath, 'utf8'));
  assert.equal(resolveContextPromotion(withdrawn, 'code_context', { ...bothVersions, jev_model: 'changed' }, fallback), 'deterministic');
  // Fault injection belongs at the OS boundary; successful writes must remain reported if lock release fails.
  await writeFile(configPath, JSON.stringify({ ...withdrawn, operations: {} }));
  const originalUnlink = installFileSystem.unlink; let lockFailure;
  try {
    installFileSystem.unlink = async (path, ...args) => {
      if (String(path).endsWith('.codex-context-policy-install.lock')) throw Object.assign(new Error('Synthetic lock release failure'), { code: 'EACCES' });
      return originalUnlink(path, ...args);
    };
    syncBuiltinESMExports();
    lockFailure = await promoteContextPolicy({ repo_root: root, report_path: reportPath, family: 'code_context', variant: 'deterministic', apply: true });
  } finally { installFileSystem.unlink = originalUnlink; syncBuiltinESMExports(); }
  assert.equal(lockFailure.changed, true);
  assert.ok(lockFailure.files.includes(await realpath(configPath)));
  assert.ok(lockFailure.error, 'A retained lock must be visible to the caller after successful writes');
  await originalUnlink(join(directory, '.codex-context-policy-install.lock'));
});
