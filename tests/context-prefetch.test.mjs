import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { captureContextTask, saveContextTask, readContextTask, resolveContextDecision, resolveContextFacts } from '../src/context-state.mjs';
import { prepareCodexContext } from '../src/context-prefetch.mjs';
import { updateContextPolicyInstall } from '../scripts/manage-context-policy.mjs';
import { readContextSourceVersions } from '../src/codex-context-policy.mjs';
import { comparePilotRuns } from '../src/context-promotion.mjs';
import { createContextPilotRuns } from './context-pilot-runs.fixture.mjs';

const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'context-prefetch-tests-')));
after(() => assert.equal(spawnSync('trash', [temporaryRoot]).status, 0));
const gitEnvironment = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const versions = { client_version: '0.159.2', policy_hash: 'a'.repeat(64), questions_hash: 'b'.repeat(64), jev_model: null };

// Preparing only after a skill is selected, cutting Unicode evidence or executing project checks breaks this boundary.
test('automatic_context_budget_and_modes', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'repository-'));
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, env: gitEnvironment });
  git(['-c', 'init.templateDir=', 'init', '--initial-branch=fixture-main']);
  git(['config', 'core.excludesFile', '/dev/null']);
  git(['config', 'core.attributesFile', '/dev/null']);
  await mkdir(join(root, 'src')); await mkdir(join(root, 'docs'));
  const content = 'export const usefulEvidence = 17;\n';
  await writeFile(join(root, 'src/input.mjs'), content);
  await writeFile(join(root, 'docs/input.md'), 'The input entry point exports usefulEvidence.\n');
  await writeFile(join(root, 'README.md'), 'Read the input documentation for exported values.\n');
  const packageContent = JSON.stringify({ scripts: { test: "node -e \"require('node:fs').writeFileSync('.git/automatic-check-ran', 'executed')\"" } }) + '\n';
  await writeFile(join(root, 'package.json'), packageContent);
  git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture: preparation']);
  const stateDir = join(temporaryRoot, 'private-state');
  const state = await captureContextTask({ cwd: root, session_id: 'prefetch-session', turn_id: 'prefetch-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Explain src/input.mjs.', permission_mode: 'read-only', versions }, null);
  assert.equal(state.repo_head, git(['rev-parse', 'HEAD']).toString().trim(),
    'Task capture must retain HEAD from the same validated snapshot for native trial admission');
  assert.equal(await saveContextTask(stateDir, state), true);
  const decision = resolveContextDecision(state, resolveContextFacts(state), null);
  const bundle = await prepareCodexContext(state, decision, versions, { state_dir: stateDir, signal: AbortSignal.timeout(2000) });
  assert.ok(bundle, 'An explicit path must automatically prepare exact context without skill selection');
  assert.equal(bundle.status, 'ok');
  assert.ok(bundle.entries.some(entry => entry.path === 'src/input.mjs' && entry.content === content && entry.protected));
  assert.ok(Buffer.byteLength(JSON.stringify(bundle)) <= 6000);
  const baseline = await prepareCodexContext(state, { ...decision, action: 'baseline', operation: 'baseline' }, versions, { state_dir: stateDir });
  assert.equal(baseline, null);
  const controller = new AbortController(); controller.abort();
  assert.equal(await prepareCodexContext(state, decision, versions, { state_dir: stateDir, signal: controller.signal }), null);
  assert.equal(await readFile(join(root, 'package.json'), 'utf8'), packageContent, 'Preparation cannot change project configuration');
  assert.equal(await readFile(join(root, '.git/automatic-check-ran')).then(() => true, error => error.code !== 'ENOENT'), false,
    'Automatic preparation cannot execute an explicitly declared project check');
  await writeFile(join(root, 'src/input.mjs'), 'export const usefulEvidence = 18;\n');
  const reviewState = await captureContextTask({ cwd: root, session_id: 'review-session', turn_id: 'review-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Review all changes and inspect src/input.mjs.', permission_mode: 'read-only', versions }, null);
  assert.equal(await saveContextTask(stateDir, reviewState), true);
  const review = await prepareCodexContext(reviewState, resolveContextDecision(reviewState, resolveContextFacts(reviewState), null),
    versions, { state_dir: stateDir });
  assert.ok(review, 'Review recipes require changes and selected code');
  assert.ok(review.entries.some(entry => entry.kind === 'change' && entry.content.includes('+export const usefulEvidence = 18;')));
  assert.ok(review.entries.some(entry => entry.path === 'src/input.mjs' && entry.kind !== 'change'));
  for (const [index, prompt] of ['Review only the staged change in src/input.mjs.',
    'Review Git range HEAD..HEAD; report uncommitted changes separately outside the range.',
    'Review staged changes.', 'Review commit abc1234.', 'Review HEAD~1.',
    'Review the diff against develop.', 'Review PR #3.', 'Review what I committed.',
    'Review changes vs develop.', 'Review changes versus main.', 'Review merged changes.', 'Review src/input.mjs.',
    'Review all changes to src/input.mjs.', 'Review all changes under src/.'].entries()) {
    const scoped = await captureContextTask({ cwd: root, session_id: 'scoped-review-' + index, turn_id: 'scoped-turn',
      hook_event_name: 'UserPromptSubmit', prompt, permission_mode: 'read-only', versions }, null);
    assert.equal(await saveContextTask(stateDir, scoped), true);
    assert.equal(await prepareCodexContext(scoped, resolveContextDecision(scoped, resolveContextFacts(scoped), null),
      versions, { state_dir: stateDir }), null, 'A worktree-only recipe cannot silently broaden an explicit staged/range review');
  }
  const documentState = await captureContextTask({ cwd: root, session_id: 'docs-session', turn_id: 'docs-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Explain the documentation.', permission_mode: 'read-only', versions }, null);
  assert.equal(await saveContextTask(stateDir, documentState), true);
  const documentation = await prepareCodexContext(documentState, resolveContextDecision(documentState, resolveContextFacts(documentState), null),
    versions, { state_dir: stateDir });
  assert.ok(documentation.entries.some(entry => entry.path === 'README.md'));
  const oversized = 'export const unicode = ' + JSON.stringify('ñ🦄'.repeat(4000)) + ';\n';
  await writeFile(join(root, 'src/input.mjs'), oversized);
  const largeState = await captureContextTask({ cwd: root, session_id: 'large-session', turn_id: 'large-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Explain src/input.mjs.', permission_mode: 'read-only', versions }, null);
  assert.equal(await saveContextTask(stateDir, largeState), true);
  const large = await prepareCodexContext(largeState, resolveContextDecision(largeState, resolveContextFacts(largeState), null),
    versions, { state_dir: stateDir });
  assert.ok(large); assert.ok(Buffer.byteLength(JSON.stringify(large)) <= 6000);
  assert.ok(!large.entries.some(entry => entry.path === 'src/input.mjs'), 'Oversized protected evidence cannot be sliced');
  assert.ok(large.omissions.some(item => item.path === 'src/input.mjs' && item.cursor));
  assert.equal(large.provenance.repo_revision, largeState.repo_revision);
  assert.equal(large.provenance.request_hash, createHash('sha256').update('Explain src/input.mjs.').digest('hex'));
  // Exercise the real hook CLI with an isolated OS home boundary, without changing process HOME or user credentials.
  await mkdir(join(root, '.git/info'), { recursive: true });
  await writeFile(join(root, '.git/info/exclude'), '.codex/\n');
  await mkdir(join(root, '.codex'));
  await writeFile(join(root, '.codex/codex-context-policy.json'), JSON.stringify({ mode: 'shadow', jev_enabled: false }), { mode: 0o600 });
  await writeFile(join(root, '.codex/codex-context-policy-coverage.json'), JSON.stringify({ client_version: '0.159.2', events: { UserPromptSubmit: 'supported' } }));
  assert.equal((await updateContextPolicyInstall({ repo_root: root, source_root: resolve('.'), action: 'install', apply: true })).error, null);
  await writeFile(join(root, 'src/input.mjs'), 'export const usefulEvidence = 18;\n');
  const installedState = await captureContextTask({ cwd: root, session_id: 'installed-review', turn_id: 'installed-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Review all changes and inspect src/input.mjs.', permission_mode: 'read-only', versions }, null);
  assert.equal(await saveContextTask(stateDir, installedState), true);
  assert.ok(await prepareCodexContext(installedState, resolveContextDecision(installedState, resolveContextFacts(installedState), null),
    versions, { state_dir: stateDir }), 'An owned operations skill must not make normal installed reviews unreadable');
  const receiptPath = join(root, '.codex/codex-context-policy-install.json'); const receiptBytes = await readFile(receiptPath, 'utf8');
  await writeFile(receiptPath, JSON.stringify({ ...JSON.parse(receiptBytes), owned_skill: null }));
  const foreignState = await captureContextTask({ cwd: root, session_id: 'foreign-review', turn_id: 'foreign-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Review all changes.', permission_mode: 'read-only', versions }, null);
  assert.equal(await saveContextTask(stateDir, foreignState), true);
  assert.equal(await prepareCodexContext(foreignState, resolveContextDecision(foreignState, resolveContextFacts(foreignState), null),
    versions, { state_dir: stateDir }), null, 'A foreign alias pointing at the same source must not borrow installation ownership');
  await writeFile(receiptPath, receiptBytes);
  const isolatedHome = join(temporaryRoot, 'hook-home'); await mkdir(isolatedHome);
  const bootstrap = join(temporaryRoot, 'isolated-home.mjs');
  await writeFile(bootstrap, "import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module';\n" +
    'os.homedir = () => ' + JSON.stringify(isolatedHome) + '; syncBuiltinESMExports();\n');
  const nativeInput = { cwd: root, session_id: 'automatic-shadow-session', turn_id: 'automatic-shadow-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Explain src/input.mjs.', permission_mode: 'read-only', client_version: '0.159.2' };
  const shadow = spawnSync(process.execPath, ['--import', bootstrap, resolve('src/codex-context-policy.mjs'), 'hook'],
    { input: JSON.stringify(nativeInput), env: gitEnvironment, encoding: 'utf8', timeout: 3000 });
  assert.equal(shadow.status, 0); assert.equal(shadow.stdout, ''); assert.equal(shadow.stderr, '');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const privateSession = join(isolatedHome, '.codex/codex-context-policy', hash(root), hash(nativeInput.session_id));
  assert.ok((await readdir(privateSession)).some(path => /^result-[a-f0-9]{64}\.json$/.test(path)),
    'UserPromptSubmit must automatically persist proposed exact context in shadow without emitting it');
  const modelInput = { ...nativeInput, model: 'fixture-main-model', reasoning_effort: 'medium' };
  const currentConfig = { mode: 'shadow', jev_enabled: false };
  const questions = JSON.parse(await readFile(new URL('../config/jev-questions.json', import.meta.url), 'utf8'));
  const currentVersions = await readContextSourceVersions(resolve('.'), { input: modelInput, config: currentConfig, questions });
  const reportPath = join(temporaryRoot, 'synthetic-qualified-report.json');
  await writeFile(reportPath, JSON.stringify(comparePilotRuns(createContextPilotRuns(currentVersions))), { mode: 0o600 });
  const promotion = spawnSync(process.execPath, [resolve('scripts/manage-context-policy.mjs'), 'promote', '--repo', root,
    '--report', reportPath, '--family', 'code_context', '--variant', 'deterministic', '--apply'], { encoding: 'utf8', timeout: 3000 });
  assert.equal(promotion.status, 0, promotion.stdout + promotion.stderr);
  const configPath = join(root, '.codex/codex-context-policy.json');
  const qualifiedConfig = JSON.parse(await readFile(configPath, 'utf8'));
  await writeFile(configPath, JSON.stringify({ ...qualifiedConfig, mode: 'enforce' }));
  const enforce = spawnSync(process.execPath, ['--import', bootstrap, resolve('src/codex-context-policy.mjs'), 'hook'],
    { input: JSON.stringify({ ...modelInput, session_id: 'qualified-session' }), env: gitEnvironment, encoding: 'utf8', timeout: 3000 });
  assert.equal(enforce.status, 0); assert.equal(enforce.stderr, '');
  assert.ok(enforce.stdout, 'Only qualified current family/model/version evidence may emit pre-generation context');
  const output = JSON.parse(enforce.stdout).hookSpecificOutput;
  assert.equal(output.hookEventName, 'UserPromptSubmit');
  assert.ok(Buffer.byteLength(output.additionalContext) <= 6000);
  const emittedSession = join(isolatedHome, '.codex/codex-context-policy', hash(root), hash('qualified-session'));
  const emissionFiles = (await readdir(emittedSession)).filter(name => name.startsWith('emission-'));
  assert.equal(emissionFiles.length, 1, 'Production emission needs a separate metadata-only proposal audit');
  const emission = JSON.parse(await readFile(join(emittedSession, emissionFiles[0]), 'utf8'));
  assert.equal(emission.bundle_hash, hash(output.additionalContext));
  assert.equal(emission.emission_attempted, true); assert.equal(emission.emitted, false); assert.equal(emission.delivery_confirmed, false,
    'Writing hook output cannot certify native delivery or authorize reuse');
  const emissionBootstrap = join(temporaryRoot, 'emission-timeout-bootstrap.mjs');
  await writeFile(emissionBootstrap, "import os from 'node:os'; import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';\n" +
    'os.homedir = () => ' + JSON.stringify(isolatedHome) + '; const originalWriteFile = fs.writeFile;\n' +
    'fs.writeFile = async (...args) => { const result = await originalWriteFile(...args); if (String(args[0]).includes("/emission-")) ' +
    'await new Promise(resolve => setTimeout(resolve, 2200)); return result; }; syncBuiltinESMExports();\n');
  const interrupted = spawnSync(process.execPath, ['--import', emissionBootstrap, resolve('src/codex-context-policy.mjs'), 'hook'],
    { input: JSON.stringify({ ...modelInput, session_id: 'interrupted-emission' }), env: gitEnvironment, encoding: 'utf8', timeout: 6000 });
  assert.equal(interrupted.status, 0, interrupted.stderr); assert.equal(interrupted.stdout, '');
  const interruptedSession = join(isolatedHome, '.codex/codex-context-policy', hash(root), hash('interrupted-emission'));
  const interruptedAuditName = (await readdir(interruptedSession)).find(name => name.startsWith('emission-'));
  const interruptedAudit = JSON.parse(await readFile(join(interruptedSession, interruptedAuditName), 'utf8'));
  assert.notEqual(interruptedAudit.emitted, true, 'A pre-output audit cannot claim emission after a deadline discards stdout');
  assert.equal(interruptedAudit.delivery_confirmed, false);
  // A deterministic record can contain runs that also qualify hybrid, without a hybrid record being installed.
  const enabled = { ...qualifiedConfig, mode: 'enforce', jev_enabled: true,
    jev_model: 'fixture-jev-model', jev_actual_model: 'fixture-jev-model' };
  await writeFile(configPath, JSON.stringify(enabled));
  const bothVersions = await readContextSourceVersions(resolve('.'), { input: modelInput, config: enabled, questions });
  const bothRuns = createContextPilotRuns(bothVersions);
  for (const row of bothRuns.filter(row => row.variant === 'hybrid')) {
    row.codex_usage.input_tokens = 600; row.codex_usage.total_tokens = 700;
  }
  await writeFile(reportPath, JSON.stringify(comparePilotRuns(bothRuns)));
  const independentPromotion = spawnSync(process.execPath, [resolve('scripts/manage-context-policy.mjs'), 'promote', '--repo', root,
    '--report', reportPath, '--family', 'code_context', '--variant', 'deterministic', '--apply'], { encoding: 'utf8', timeout: 3000 });
  assert.equal(independentPromotion.status, 0, independentPromotion.stdout + independentPromotion.stderr);
  const independent = spawnSync(process.execPath, ['--import', bootstrap, resolve('src/codex-context-policy.mjs'), 'hook'],
    { input: JSON.stringify({ ...modelInput, session_id: 'independent-deterministic' }), env: gitEnvironment, encoding: 'utf8', timeout: 3000 });
  assert.equal(independent.status, 0, independent.stderr);
  assert.ok(independent.stdout, 'An absent hybrid record must not suppress independently qualified deterministic output');
  const unknownModel = spawnSync(process.execPath, ['--import', bootstrap, resolve('src/codex-context-policy.mjs'), 'hook'],
    { input: JSON.stringify({ ...nativeInput, session_id: 'unknown-model-session' }), env: gitEnvironment, encoding: 'utf8', timeout: 3000 });
  assert.equal(unknownModel.stdout, '', 'Missing native model/effort identity cannot inherit a qualified promotion');
});

// An unnamed worktree review needs dependencies of changes beyond the first diff page.
test('unscoped_review_selects_dependencies_from_all_change_pages', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'unscoped-review-'));
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.excludesFile=/dev/null',
    '-c', 'core.attributesFile=/dev/null', ...args], { cwd: root, env: gitEnvironment });
  git(['-c', 'init.templateDir=', 'init', '--initial-branch=fixture-main']);
  git(['config', 'core.excludesFile', '/dev/null']);
  git(['config', 'core.attributesFile', '/dev/null']);
  await mkdir(join(root, 'src')); await mkdir(join(root, 'tests'));
  const files = {
    'src/a-noise.mjs': 'export const first = 1;\n', 'src/b-noise.mjs': 'export const second = 1;\n',
    'src/entry.mjs': "import { dependency } from './dependency.mjs';\nexport const entry = dependency + 1;\n",
    'src/dependency.mjs': 'export const dependency = 7;\n',
    'src/caller.mjs': "import { entry } from './entry.mjs';\nexport const caller = entry;\n",
    'tests/entry.test.mjs': "import { entry } from '../src/entry.mjs';\nif (entry !== 8) throw new Error('Synthetic check failed.');\n"
  };
  for (const [path, body] of Object.entries(files)) await writeFile(join(root, path), body);
  git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture: unscoped review']);
  await writeFile(join(root, 'src/a-noise.mjs'), 'export const first = ' + JSON.stringify('a'.repeat(4000)) + ';\n');
  await writeFile(join(root, 'src/b-noise.mjs'), 'export const second = ' + JSON.stringify('b'.repeat(4000)) + ';\n');
  await writeFile(join(root, 'src/entry.mjs'), files['src/entry.mjs'].replace('+ 1', '+ 2'));
  const stateDir = join(temporaryRoot, 'unscoped-state');
  const state = await captureContextTask({ cwd: root, session_id: 'unscoped-session', turn_id: 'unscoped-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Review all changes.', permission_mode: 'read-only', versions }, null);
  assert.equal(await saveContextTask(stateDir, state), true);
  const bundle = await prepareCodexContext(state, resolveContextDecision(state, resolveContextFacts(state), null), versions, { state_dir: stateDir });
  assert.ok(bundle, 'A bounded review must retain complete change and selection continuations');
  const selected = bundle.continuations.find(item => item.operation === 'select_code_context');
  const { readContext } = await import('../src/repository-context.mjs');
  const recovered = new Set(); let cursor;
  do {
    const page = await readContext({ repo_root: root, state_dir: stateDir, session_id: state.session_id,
      reference: selected.reference, cursor, byte_limit: 8000 });
    assert.equal(page.status, 'ok', page.stderr);
    for (const item of [...page.entries, ...page.omissions]) recovered.add(item.path);
    cursor = page.next_cursor;
  } while (cursor);
  for (const path of ['src/entry.mjs', 'src/dependency.mjs', 'src/caller.mjs', 'tests/entry.test.mjs'])
    assert.ok(recovered.has(path), 'Unscoped review must protect recoverable changed-code evidence: ' + path);
  const { unlink } = await import('node:fs/promises'); await unlink(join(root, 'src/entry.mjs'));
  const deleted = await captureContextTask({ cwd: root, session_id: 'deleted-session', turn_id: 'deleted-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Review all changes.', permission_mode: 'read-only', versions }, null);
  assert.equal(await saveContextTask(stateDir, deleted), true);
  assert.equal(await prepareCodexContext(deleted, resolveContextDecision(deleted, resolveContextFacts(deleted), null),
    versions, { state_dir: stateDir }), null, 'Unavailable changed-code dependency evidence must abstain conservatively');
});

// A completed task capture must survive an optional preparation timeout; no request was lost from continuity.
test('post_save_preparation_timeout_keeps_context_continuity', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'timeout-repository-'));
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, env: gitEnvironment });
  git(['-c', 'init.templateDir=', 'init', '--initial-branch=fixture-main']);
  git(['config', 'core.excludesFile', '/dev/null']);
  git(['config', 'core.attributesFile', '/dev/null']);
  await mkdir(join(root, 'src')); await writeFile(join(root, 'src/input.mjs'), 'export const value = 1;\n');
  await writeFile(join(root, '.gitignore'), '.codex/\n');
  git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture: preparation timeout']);
  await mkdir(join(root, '.codex'));
  await writeFile(join(root, '.codex/codex-context-policy.json'), JSON.stringify({ mode: 'shadow', jev_enabled: false }), { mode: 0o600 });
  await writeFile(join(root, '.codex/codex-context-policy-coverage.json'), JSON.stringify({ client_version: '0.159.2', events: { UserPromptSubmit: 'supported' } }));
  assert.equal((await updateContextPolicyInstall({ repo_root: root, source_root: resolve('.'), action: 'install', apply: true })).error, null);
  const isolatedHome = join(temporaryRoot, 'timeout-home'); await mkdir(isolatedHome);
  const bootstrap = join(temporaryRoot, 'timeout-bootstrap.mjs');
  await writeFile(bootstrap, "import os from 'node:os'; import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';\n" +
    'os.homedir = () => ' + JSON.stringify(isolatedHome) + '; const originalOpen = fs.open; let reads = 0;\n' +
    'fs.open = async (path, ...args) => { if (path === ' + JSON.stringify(join(root, 'src/input.mjs')) +
    ' && ++reads === 2) await new Promise(resolve => setTimeout(resolve, 2200)); return originalOpen(path, ...args); };\n' +
    'syncBuiltinESMExports();\n');
  const input = { cwd: root, session_id: 'timeout-session', turn_id: 'timeout-turn', hook_event_name: 'UserPromptSubmit',
    prompt: 'Explain src/input.mjs.', permission_mode: 'read-only', client_version: '0.159.2' };
  const child = spawnSync(process.execPath, ['--import', bootstrap, resolve('src/codex-context-policy.mjs'), 'hook'],
    { input: JSON.stringify(input), env: gitEnvironment, encoding: 'utf8', timeout: 6000 });
  assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout, '');
  const task = await readContextTask(join(isolatedHome, '.codex/codex-context-policy'), root, input.session_id);
  assert.ok(task, 'Capture must have been persisted before the preparation timeout');
  assert.equal(task.history_gap, false, 'An optional failure after durable capture is not a history gap');
});
