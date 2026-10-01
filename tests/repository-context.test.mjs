import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, symlink, chmod } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { captureContextTask, saveContextTask, captureRepositorySnapshot } from '../src/context-state.mjs';
import { selectCodeContext } from '../src/repository-context.mjs';
import * as repositoryContext from '../src/repository-context.mjs';

const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'repository-context-tests-')));
after(() => assert.equal(spawnSync('trash', [temporaryRoot]).status, 0));
const gitEnvironment = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

// Dropping an explicit target, its found callers/dependencies or applicable instructions breaks this boundary.
test('protected_evidence_and_exact_pages', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'protected-'));
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, env: gitEnvironment });
  git(['-c', 'init.templateDir=', 'init', '--initial-branch=fixture-main']);
  git(['config', 'core.excludesFile', '/dev/null']); git(['config', 'core.attributesFile', '/dev/null']);
  const files = {
    'src/report.mjs': "import { normalize } from './normalize.mjs';\nexport function buildReport(value) { return normalize(value); }\n",
    'src/normalize.mjs': 'export function normalize(value) { return String(value).trim(); }\n',
    'src/main.mjs': "import { buildReport } from './report.mjs';\nexport const report = buildReport('fixture');\n",
    'tests/report.test.mjs': "import { buildReport } from '../src/report.mjs';\nif (buildReport(' fixture ') !== 'fixture') throw new Error('Fixture report');\n",
    'docs/report.md': 'The buildReport entry point calls normalize before returning its report.\n',
    'AGENTS.md': 'Preserve applicable repository instructions and full required evidence.\n',
    'package.json': '{"type":"module","scripts":{"test":"node --test tests/report.test.mjs"}}\n',
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), content);
  }
  git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture: protected repository']);
  const state = await captureContextTask({ cwd: root, session_id: 'protected-session', turn_id: 'protected-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Explain src/report.mjs and `buildReport`.', permission_mode: 'read-only' }, null);
  const bundle = await selectCodeContext({ repo_root: root, request_hash: state.request_hash,
    repo_revision: state.repo_revision, context_epoch: state.context_epoch, paths: ['src/report.mjs'],
    symbols: ['buildReport'], family: 'code_context', scope: { kind: 'worktree' }, exhaustive: false,
    byte_limit: 6000, signal: AbortSignal.timeout(2000) });
  assert.equal(bundle.status, 'ok', 'A verified explicit request must retrieve protected repository evidence');
  for (const path of Object.keys(files)) {
    const entry = bundle.entries.find(entry => entry.path === path);
    assert.ok(entry?.protected, 'Required evidence must remain protected: ' + path);
    assert.equal(entry.content, await readFile(join(root, path), 'utf8'), 'Delivered fragments must retain exact bytes');
    assert.equal(entry.start_line, 1);
  }
  assert.equal(bundle.coverage_status, 'partial', 'Text references cannot certify complete dependency coverage');
  assert.ok(Buffer.byteLength(JSON.stringify(bundle)) <= 6000);
  // Rejecting a large result or silently dropping its tail prevents exact progressive recovery.
  const stateDir = join(temporaryRoot, 'private-context');
  assert.equal(await saveContextTask(stateDir, state), true);
  const first = await selectCodeContext({ repo_root: root, request_hash: state.request_hash,
    repo_revision: state.repo_revision, context_epoch: state.context_epoch, paths: ['src/report.mjs'],
    symbols: ['buildReport'], family: 'code_context', scope: { kind: 'worktree' }, exhaustive: true,
    state_dir: stateDir, session_id: state.session_id, byte_limit: 1300 });
  assert.equal(first.status, 'ok', 'A limited page must preserve an expandable exact result');
  assert.match(first.full_result, /^[a-f0-9]{64}$/);
  assert.ok(first.next_cursor, 'The remaining protected evidence must have a continuation');
  const recovered = [...first.entries]; let cursor = first.next_cursor;
  for (let pageCount = 0; cursor && pageCount < 20; pageCount++) {
    const page = await repositoryContext.readContext({ repo_root: root, state_dir: stateDir,
      session_id: state.session_id, reference: first.full_result, cursor, byte_limit: 1300 });
    assert.equal(page.status, 'ok');
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1300, 'The complete response envelope counts against its byte limit');
    assert.equal(page.omissions.length, 0, 'These whole files individually fit the page budget');
    recovered.push(...page.entries); cursor = page.next_cursor;
  }
  assert.equal(cursor, null, 'Continuation must terminate');
  assert.deepEqual(recovered.map(entry => entry.path).sort(), Object.keys(files).sort());
  for (const entry of recovered) assert.equal(entry.content, files[entry.path]);
  // The native skill's real command must deliver the same recoverable protocol, without hooks or network.
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../src/codex-context-policy.mjs', import.meta.url)), 'select_code_context'],
    { input: JSON.stringify({ repo_root: root, state_dir: stateDir, session_id: state.session_id,
      paths: ['src/report.mjs'], symbols: ['buildReport'], family: 'code_context', scope: { kind: 'worktree' },
      exhaustive: true, byte_limit: 1300 }), encoding: 'utf8', timeout: 3000 });
  assert.equal(cli.status, 0, 'The explicit context CLI must execute and emit a JSON evidence page: ' + cli.stderr);
  const cliPage = JSON.parse(cli.stdout); assert.equal(cliPage.status, 'ok'); assert.ok(cliPage.full_result);
  const expandedCli = spawnSync(process.execPath, [fileURLToPath(new URL('../src/codex-context-policy.mjs', import.meta.url)), 'read_context'],
    { input: JSON.stringify({ repo_root: root, state_dir: stateDir, session_id: state.session_id,
      reference: cliPage.full_result, cursor: cliPage.next_cursor, byte_limit: 1300 }), encoding: 'utf8', timeout: 3000 });
  assert.equal(expandedCli.status, 0, expandedCli.stderr);
  assert.ok(JSON.parse(expandedCli.stdout).entries.length, 'The CLI continuation must expand exact whole evidence');
  const noMatches = await selectCodeContext({ repo_root: root, request_hash: state.request_hash,
    repo_revision: state.repo_revision, context_epoch: state.context_epoch, paths: ['src/report.mjs'],
    symbols: ['noSuchFixtureSymbol'], family: 'code_context', scope: { kind: 'worktree' }, exhaustive: false });
  assert.equal(noMatches.status, 'ok', 'rg exit 1 means no matches, not an error');
  assert.ok(noMatches.entries.some(entry => entry.path === 'src/main.mjs' && entry.protected),
    'An explicit target must retain its literal import callers even without a named symbol');
  const failureBin = join(temporaryRoot, 'failing-tools'); await mkdir(failureBin);
  await writeFile(join(failureBin, 'rg'), '#!/bin/sh\nprintf "Fixture rg search denied\\n" >&2\nexit 7\n');
  await chmod(join(failureBin, 'rg'), 0o700);
  const failedSearch = spawnSync(process.execPath, [fileURLToPath(new URL('../src/codex-context-policy.mjs', import.meta.url)), 'select_code_context'],
    { env: { ...process.env, PATH: failureBin + ':' + process.env.PATH }, encoding: 'utf8', timeout: 3000,
      input: JSON.stringify({ repo_root: root, state_dir: stateDir, session_id: state.session_id, paths: ['src/report.mjs'],
        symbols: ['buildReport'], family: 'code_context', scope: { kind: 'worktree' }, exhaustive: false }) });
  assert.equal(failedSearch.status, 7, 'Tool failures must preserve the original exit code');
  const failedPage = JSON.parse(failedSearch.stdout);
  assert.equal(failedPage.status, 'error'); assert.equal(failedPage.stderr, 'Fixture rg search denied\n');
  assert.deepEqual(failedPage.entries, [], 'Failed evidence reads cannot masquerade as empty success');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const privateCorruption = 'SYNTHETIC_PRIVATE_RESULT_VALUE'; const corruptReference = hash(privateCorruption);
  await writeFile(join(stateDir, hash(root), hash(state.session_id), 'result-' + corruptReference + '.json'),
    privateCorruption, { mode: 0o600 });
  const corrupt = await repositoryContext.readContext({ repo_root: root, state_dir: stateDir,
    session_id: state.session_id, reference: corruptReference, byte_limit: 1300 });
  assert.equal(corrupt.status, 'error');
  assert.equal(JSON.stringify(corrupt).includes('SYNTHETIC'), false, 'Malformed private content must never leak through parse diagnostics');
  const wrongSession = await repositoryContext.readContext({ repo_root: root, state_dir: stateDir,
    session_id: 'another-session', reference: first.full_result, byte_limit: 1300 });
  assert.equal(wrongSession.status, 'error', 'Private results cannot cross session identities');
  await writeFile(join(root, 'src/report.mjs'), files['src/report.mjs'] + '// Changed after capture.\n');
  const stale = await repositoryContext.readContext({ repo_root: root, state_dir: stateDir,
    session_id: state.session_id, reference: first.full_result, byte_limit: 1300 });
  assert.equal(stale.status, 'stale', 'Expansion must reject changed repository bytes');
  assert.deepEqual(stale.entries, []);
  // Lossy UTF-8 decoding, ignored-path omission or truncation must not destroy explicit evidence.
  const oversizedPath = 'src/large space\nUnicode-ñ.mjs';
  const ignoredPath = 'private fixture.bin';
  const oversizedContent = 'export const evidence = ' + JSON.stringify('ñ🦄'.repeat(3000)) + ';\n';
  const binaryBytes = Buffer.from([0xff, 0x00, 0x80, 0x41, 0x0a]);
  await writeFile(join(root, oversizedPath), oversizedContent);
  await writeFile(join(root, '.gitignore'), ignoredPath + '\n');
  await writeFile(join(root, ignoredPath), binaryBytes);
  const nextState = await captureContextTask({ cwd: root, session_id: state.session_id, turn_id: 'large-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Inspect the explicit evidence.', permission_mode: 'read-only' }, state);
  assert.equal(await saveContextTask(stateDir, nextState), true);
  const large = await selectCodeContext({ repo_root: root, request_hash: nextState.request_hash,
    repo_revision: nextState.repo_revision, context_epoch: nextState.context_epoch, paths: [oversizedPath, ignoredPath],
    symbols: [], family: 'code_context', scope: { kind: 'worktree' }, exhaustive: true,
    state_dir: stateDir, session_id: state.session_id, byte_limit: 1300 });
  assert.equal(large.status, 'ok', 'Large and binary explicit evidence must remain discoverable');
  const units = [...large.entries]; const omissions = [...large.omissions]; cursor = large.next_cursor;
  for (let pageCount = 0; cursor && pageCount < 20; pageCount++) {
    const page = await repositoryContext.readContext({ repo_root: root, state_dir: stateDir,
      session_id: state.session_id, reference: large.full_result, cursor, byte_limit: 1300 });
    assert.equal(page.status, 'ok'); assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1300);
    units.push(...page.entries); omissions.push(...page.omissions); cursor = page.next_cursor;
  }
  assert.equal(cursor, null);
  for (const path of [oversizedPath, ignoredPath]) {
    const omitted = omissions.find(item => item.path === path);
    assert.ok(omitted?.cursor, 'Every oversized/binary unit requires explicit exact retrieval');
    const whole = await repositoryContext.readContext({ repo_root: root, state_dir: stateDir,
      session_id: state.session_id, reference: large.full_result, cursor: omitted.cursor, byte_limit: 1300 });
    assert.equal(whole.status, 'ok'); assert.equal(whole.retrieval, 'whole-unit');
    const entry = whole.entries.find(entry => entry.path === path);
    if (path === oversizedPath) assert.equal(entry.content, oversizedContent);
    else { assert.equal(entry.encoding, 'base64'); assert.deepEqual(Buffer.from(entry.content, 'base64'), binaryBytes); }
  }
  assert.ok(!units.some(entry => entry.path === ignoredPath), 'Routine pages inventory binary evidence without lossy inline text');
  await writeFile(join(root, ignoredPath), Buffer.from([0x42]));
  assert.equal((await repositoryContext.readContext({ repo_root: root, state_dir: stateDir,
    session_id: state.session_id, reference: large.full_result, byte_limit: 1300 })).status, 'stale',
  'Expansion must revalidate explicitly selected ignored bytes too');
  const outside = join(temporaryRoot, 'outside.txt'); await writeFile(outside, 'Outside fixture bytes must never be delivered.');
  const linkPath = 'src/external-link.mjs'; await symlink(outside, join(root, linkPath));
  const linkedState = await captureContextTask({ cwd: root, session_id: state.session_id, turn_id: 'link-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Inspect src/external-link.mjs.', permission_mode: 'read-only' }, nextState);
  const linked = await selectCodeContext({ repo_root: root, request_hash: linkedState.request_hash,
    repo_revision: linkedState.repo_revision, context_epoch: linkedState.context_epoch, paths: [linkPath],
    symbols: [], family: 'code_context', scope: { kind: 'worktree' }, exhaustive: true });
  assert.equal(linked.status, 'error'); assert.deepEqual(linked.entries, []);
});

// Dropping staged/unstaged/deleted/new changes, or invoking clean filters, loses review evidence or executes repository code.
test('repository_changes_preserve_raw_stages_and_scope', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'changes-'));
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, env: gitEnvironment });
  git(['-c', 'init.templateDir=', 'init', '--initial-branch=fixture-main']);
  git(['config', 'core.excludesFile', '/dev/null']); git(['config', 'core.attributesFile', '/dev/null']);
  await writeFile(join(root, 'change space\nñ.mjs'), 'export const value = 1;\n');
  await writeFile(join(root, 'deleted.mjs'), 'export const deleted = true;\n');
  git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture: base changes']);
  const base = git(['rev-parse', 'HEAD']).toString().trim();
  await writeFile(join(root, 'change space\nñ.mjs'), 'export const value = 2;\n'); git(['add', '--', 'change space\nñ.mjs']);
  git(['mv', '--', 'deleted.mjs', 'renamed.mjs']);
  await writeFile(join(root, 'change space\nñ.mjs'), 'export const value = 3;\n');
  await writeFile(join(root, 'new.mjs'), 'export const added = true;\n');
  // This valid filter would write outside the source if status/worktree Git conversion were accidentally used.
  const sentinel = join(temporaryRoot, 'filter-was-executed');
  git(['config', 'filter.unsafe.clean', 'printf executed > "' + sentinel + '"; cat']);
  await writeFile(join(root, '.gitattributes'), '*.mjs filter=unsafe\n');
  const state = await captureContextTask({ cwd: root, session_id: 'changes-session', turn_id: 'changes-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Review all changes.', permission_mode: 'read-only' }, null);
  const stateDir = join(temporaryRoot, 'changes-state'); assert.equal(await saveContextTask(stateDir, state), true);
  assert.equal(typeof repositoryContext.getRepositoryChanges, 'function', 'The changes operation must execute a real raw evidence read');
  const changes = await repositoryContext.getRepositoryChanges({ repo_root: root, request_hash: state.request_hash,
    repo_revision: state.repo_revision, context_epoch: state.context_epoch, scope: { kind: 'worktree' },
    state_dir: stateDir, session_id: state.session_id, byte_limit: 8000 });
  assert.equal(changes.status, 'ok', changes.stderr);
  const changed = changes.entries.filter(entry => entry.kind === 'change');
  assert.ok(changed.some(entry => entry.path === 'change space\nñ.mjs' && entry.stage === 'staged' &&
    entry.content.includes('-export const value = 1;') && entry.content.includes('+export const value = 2;')));
  assert.ok(changed.some(entry => entry.path === 'change space\nñ.mjs' && entry.stage === 'unstaged' &&
    entry.content.includes('-export const value = 2;') && entry.content.includes('+export const value = 3;')));
  assert.ok(changed.some(entry => entry.path === 'deleted.mjs' && entry.change === 'deleted'));
  assert.ok(changed.some(entry => entry.path === 'renamed.mjs' && entry.change === 'added'));
  assert.ok(changed.some(entry => entry.path === 'new.mjs' && entry.stage === 'untracked' && entry.content.includes('+export const added = true;')));
  assert.ok(changed.every(entry => entry.protected));
  assert.equal(changes.coverage_status, 'complete');
  const limited = await repositoryContext.getRepositoryChanges({ repo_root: root, request_hash: state.request_hash,
    repo_revision: state.repo_revision, context_epoch: state.context_epoch, scope: { kind: 'worktree' },
    state_dir: stateDir, session_id: state.session_id, byte_limit: 1300 });
  assert.equal(limited.status, 'ok'); assert.ok(limited.next_cursor);
  const recoveredChanges = [...limited.entries]; let continuation = limited.next_cursor;
  for (let pageCount = 0; continuation && pageCount < 20; pageCount++) {
    const page = await repositoryContext.readContext({ repo_root: root, state_dir: stateDir,
      session_id: state.session_id, reference: limited.full_result, cursor: continuation, byte_limit: 1300 });
    assert.equal(page.status, 'ok'); assert.equal(page.coverage_status, 'partial',
      'A tail page cannot claim it contains the complete review change inventory');
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1300);
    assert.equal(page.omissions.length, 0);
    recoveredChanges.push(...page.entries); continuation = page.next_cursor;
  }
  assert.equal(continuation, null); assert.deepEqual(recoveredChanges, changes.entries);
  assert.equal(await readFile(sentinel).then(() => true, error => error.code !== 'ENOENT'), false, 'Evidence reads cannot execute configured clean filters');
  // Remove the fixture's dangerous conversion configuration before creating the independent commit-range scope.
  git(['config', '--unset', 'filter.unsafe.clean']);
  git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture: range changes']);
  const head = git(['rev-parse', 'HEAD']).toString().trim();
  const rangeState = await captureContextTask({ cwd: root, session_id: state.session_id, turn_id: 'range-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Review the committed range.', permission_mode: 'read-only' }, state);
  assert.equal(await saveContextTask(stateDir, rangeState), true);
  const range = await repositoryContext.getRepositoryChanges({ repo_root: root, request_hash: rangeState.request_hash,
    repo_revision: rangeState.repo_revision, context_epoch: rangeState.context_epoch, scope: { kind: 'range', base, head },
    state_dir: stateDir, session_id: state.session_id, byte_limit: 8000 });
  assert.equal(range.status, 'ok', range.stderr);
  assert.ok(range.entries.some(entry => entry.path === 'change space\nñ.mjs' && entry.content.includes('+export const value = 3;')));
  assert.ok(range.entries.every(entry => entry.stage === 'range'));
  await writeFile(join(root, 'change space\nñ.mjs'), 'export const value = 999;\n');
  const dirtyState = await captureContextTask({ cwd: root, session_id: state.session_id, turn_id: 'dirty-range-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Explain the committed target.', permission_mode: 'read-only' }, rangeState);
  assert.equal(await saveContextTask(stateDir, dirtyState), true);
  const committedContext = await selectCodeContext({ repo_root: root, request_hash: dirtyState.request_hash,
    repo_revision: dirtyState.repo_revision, context_epoch: dirtyState.context_epoch, scope: { kind: 'range', base, head },
    paths: ['change space\nñ.mjs'], symbols: ['value'], family: 'code_review_context', exhaustive: true,
    state_dir: stateDir, session_id: state.session_id, byte_limit: 8000 });
  assert.equal(committedContext.status, 'ok', 'Commit-scoped context must come from the requested immutable target');
  assert.equal(committedContext.entries.find(entry => entry.path === 'change space\nñ.mjs').content, 'export const value = 3;\n');
  const originalBlob = git(['rev-parse', head + ':change space\nñ.mjs']).toString().trim();
  const replacement = execFileSync('git', ['hash-object', '-w', '--stdin'],
    { cwd: root, env: gitEnvironment, input: 'export const value = 777;\n', encoding: 'utf8' }).trim();
  git(['replace', originalBlob, replacement]);
  const replaced = await selectCodeContext({ repo_root: root, request_hash: dirtyState.request_hash,
    repo_revision: dirtyState.repo_revision, context_epoch: dirtyState.context_epoch, scope: { kind: 'range', base, head },
    paths: ['change space\nñ.mjs'], symbols: [], family: 'code_review_context', exhaustive: true, byte_limit: 8000 });
  assert.equal(replaced.status, 'ok', replaced.stderr);
  assert.equal(replaced.entries.find(entry => entry.path === 'change space\nñ.mjs').content, 'export const value = 3;\n',
    'Immutable target evidence must ignore repository replacement refs');
  const expandedRange = await repositoryContext.readContext({ repo_root: root, state_dir: stateDir,
    session_id: state.session_id, reference: committedContext.full_result, byte_limit: 8000 });
  assert.equal(expandedRange.status, 'ok', expandedRange.stderr);
  assert.equal(expandedRange.entries.find(entry => entry.path === 'change space\nñ.mjs').content, 'export const value = 3;\n');
  // Restore the exact previous raw revision for the remaining independent Git failure controls.
  await writeFile(join(root, 'change space\nñ.mjs'), 'export const value = 3;\n');
  const missingCommit = await repositoryContext.getRepositoryChanges({ repo_root: root, request_hash: rangeState.request_hash,
    repo_revision: rangeState.repo_revision, context_epoch: rangeState.context_epoch,
    scope: { kind: 'range', base: 'f'.repeat(40), head }, byte_limit: 8000 });
  assert.equal(missingCommit.status, 'error'); assert.equal(missingCommit.exit_code, 128);
  assert.match(missingCommit.stderr, /fatal:/, 'A Git failure must retain its original diagnostic');
  const badRange = await repositoryContext.getRepositoryChanges({ repo_root: root, request_hash: rangeState.request_hash,
    repo_revision: rangeState.repo_revision, context_epoch: rangeState.context_epoch,
    scope: { kind: 'range', base: '--output=unsafe', head }, byte_limit: 8000 });
  assert.equal(badRange.status, 'error'); assert.deepEqual(badRange.entries, []);
});

// Replaying a cached executable-mode change after chmod reverses it supplies obsolete review evidence.
test('repository_change_expansion_rejects_executable_mode_changes', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'mode-'));
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, env: gitEnvironment });
  git(['-c', 'init.templateDir=', 'init', '--initial-branch=fixture-main']);
  git(['config', 'core.excludesFile', '/dev/null']); git(['config', 'core.attributesFile', '/dev/null']);
  await writeFile(join(root, 'run.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o644 });
  git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture: modes']);
  await chmod(join(root, 'run.sh'), 0o755);
  const state = await captureContextTask({ cwd: root, session_id: 'mode-session', turn_id: 'mode-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Review all changes.', permission_mode: 'read-only' }, null);
  const stateDir = join(temporaryRoot, 'mode-state'); assert.equal(await saveContextTask(stateDir, state), true);
  const changes = await repositoryContext.getRepositoryChanges({ repo_root: root, request_hash: state.request_hash,
    repo_revision: state.repo_revision, context_epoch: state.context_epoch, scope: { kind: 'worktree' },
    state_dir: stateDir, session_id: state.session_id, byte_limit: 8000 });
  assert.equal(changes.status, 'ok', changes.stderr);
  assert.ok(changes.entries.some(entry => entry.change === 'mode-changed'));
  await chmod(join(root, 'run.sh'), 0o644);
  const expanded = await repositoryContext.readContext({ repo_root: root, state_dir: stateDir,
    session_id: state.session_id, reference: changes.full_result });
  assert.equal(expanded.status, 'stale', 'Executable mode belongs to the raw repository revision');
  assert.deepEqual(expanded.entries, []);
  await chmod(join(root, 'run.sh'), 0o654);
  const groupExecutable = await captureContextTask({ cwd: root, session_id: 'group-mode-session',
    hook_event_name: 'UserPromptSubmit', prompt: 'Review all changes.', permission_mode: 'read-only' }, null);
  const groupChanges = await repositoryContext.getRepositoryChanges({ repo_root: root, request_hash: groupExecutable.request_hash,
    repo_revision: groupExecutable.repo_revision, context_epoch: groupExecutable.context_epoch, scope: { kind: 'worktree' }, byte_limit: 8000 });
  assert.equal(groupChanges.status, 'ok', groupChanges.stderr);
  assert.deepEqual(groupChanges.entries, [], 'Git executable mode represents owner execute, not group/other permissions');
});

// Missing objects must remain errors, without executing a configured lazy-fetch transport or writing objects.
test('repository_object_reads_never_start_lazy_fetch', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'missing-object-'));
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, env: gitEnvironment });
  git(['-c', 'init.templateDir=', 'init', '--initial-branch=fixture-main']);
  git(['config', 'core.excludesFile', '/dev/null']); git(['config', 'core.attributesFile', '/dev/null']);
  await writeFile(join(root, 'entry.mjs'), 'export const value = 1;\n');
  git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture: local objects']);
  const head = git(['rev-parse', 'HEAD']).toString().trim();
  const sentinel = join(temporaryRoot, 'lazy-fetch-started'); const helper = join(temporaryRoot, 'fixture-transport');
  await writeFile(helper, '#!/bin/sh\nprintf started > "' + sentinel + '"\nexit 7\n', { mode: 0o700 });
  git(['config', 'remote.fixture.url', 'ext::' + helper]); git(['config', 'remote.fixture.promisor', 'true']);
  git(['config', 'extensions.partialClone', 'fixture']); git(['config', 'protocol.ext.allow', 'always']);
  git(['update-index', '--cacheinfo', '100644,' + '1'.repeat(40) + ',entry.mjs']);
  const state = await captureContextTask({ cwd: root, session_id: 'missing-session', turn_id: 'missing-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Review all changes.', permission_mode: 'read-only' }, null);
  const request = { repo_root: root, request_hash: state.request_hash, repo_revision: state.repo_revision,
    context_epoch: state.context_epoch, byte_limit: 8000 };
  assert.equal((await repositoryContext.getRepositoryChanges({ ...request, scope: { kind: 'worktree' } })).status, 'error');
  assert.equal(await readFile(sentinel).then(() => true, error => error.code !== 'ENOENT'), false,
    'Read-only context must not execute a repository transport');
  assert.equal((await selectCodeContext({ ...request, scope: { kind: 'range', base: head, head: '2'.repeat(40) },
    paths: ['entry.mjs'], symbols: [], family: 'code_context', exhaustive: true })).status, 'error');
  assert.equal(await readFile(sentinel).then(() => true, error => error.code !== 'ENOENT'), false);
});

// One ordinary edit in a medium repository must not spend the shared deadline launching one Git process per file.
test('repository_changes_batch_unchanged_objects_within_deadline', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'batch-'));
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, env: gitEnvironment });
  git(['-c', 'init.templateDir=', 'init', '--initial-branch=fixture-main']);
  git(['config', 'core.excludesFile', '/dev/null']); git(['config', 'core.attributesFile', '/dev/null']);
  for (let i = 0; i < 200; i++) await writeFile(join(root, 'record-' + i + '.mjs'), 'export const value = ' + i + ';\n');
  git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture: batch objects']);
  await writeFile(join(root, 'record-0.mjs'), 'export const value = 999;\n');
  const state = await captureContextTask({ cwd: root, session_id: 'batch-session', turn_id: 'batch-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Review all changes.', permission_mode: 'read-only' }, null);
  const changes = await repositoryContext.getRepositoryChanges({ repo_root: root, request_hash: state.request_hash,
    repo_revision: state.repo_revision, context_epoch: state.context_epoch, scope: { kind: 'worktree' }, byte_limit: 8000 });
  assert.equal(changes.status, 'ok', changes.stderr);
  assert.equal(changes.entries.length, 1); assert.equal(changes.entries[0].path, 'record-0.mjs');
  assert.ok(changes.entries[0].content.includes('+export const value = 999;'));
  const selected = await selectCodeContext({ repo_root: root, request_hash: state.request_hash,
    repo_revision: state.repo_revision, context_epoch: state.context_epoch, scope: { kind: 'range',
      base: state.repo_head, head: state.repo_head }, paths: ['record-0.mjs'], symbols: [], family: 'code_context',
    exhaustive: true, byte_limit: 8000 });
  assert.equal(selected.status, 'ok', selected.stderr);
  assert.equal(selected.entries.find(entry => entry.path === 'record-0.mjs').content, 'export const value = 0;\n');
  const toolDirectory = join(temporaryRoot, 'trash-inspector'); await mkdir(toolDirectory);
  const observationPath = join(temporaryRoot, 'scratch-disposal.json');
  const trashPath = execFileSync('which', ['trash'], { encoding: 'utf8' }).trim();
  await writeFile(join(toolDirectory, 'trash'), '#!/usr/bin/env node\n' +
    "const fs = require('node:fs'); const {spawnSync} = require('node:child_process'); const path = require('node:path');\n" +
    'const directory = process.argv[2]; const sizes = ["before", "after"].map(name => { try { return fs.statSync(path.join(directory,name)).size; } catch { return 0; } });\n' +
    'fs.writeFileSync(' + JSON.stringify(observationPath) + ', JSON.stringify(sizes));\n' +
    'process.exit(spawnSync(' + JSON.stringify(trashPath) + ', process.argv.slice(2)).status ?? 1);\n', { mode: 0o700 });
  const stateDir = join(temporaryRoot, 'batch-state'); assert.equal(await saveContextTask(stateDir, state), true);
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('../src/codex-context-policy.mjs', import.meta.url)), 'get_repository_changes'],
    { input: JSON.stringify({ repo_root: root, state_dir: stateDir, session_id: state.session_id, scope: { kind: 'worktree' } }),
      env: { ...gitEnvironment, PATH: toolDirectory + ':' + process.env.PATH }, encoding: 'utf8', timeout: 3000 });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(await readFile(observationPath, 'utf8')), [0, 0],
    'Trash must receive no retained raw repository scratch bytes');
});

// Global ignore intent must survive disabling unrelated Git configuration and external helpers.
test('repository_inventory_preserves_effective_global_excludes', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'global-excludes-'));
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.excludesFile=/dev/null',
    '-c', 'core.attributesFile=/dev/null', ...args], { cwd: root, env: gitEnvironment });
  git(['-c', 'init.templateDir=', 'init', '--initial-branch=fixture-main']);
  await writeFile(join(root, 'entry.mjs'), 'export const value = 1;\n');
  git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture: excludes']);
  await writeFile(join(root, 'ignored-private.md'), 'Synthetic ignored repository evidence.\n');
  const ignorePath = join(temporaryRoot, 'global-ignore'); await writeFile(ignorePath, 'ignored-private.md\n');
  const configPath = join(temporaryRoot, 'global-config'); await writeFile(configPath, '[core]\nexcludesFile = ' + ignorePath + '\n');
  const prior = process.env.GIT_CONFIG_GLOBAL;
  try {
    process.env.GIT_CONFIG_GLOBAL = configPath;
    const snapshot = await captureRepositorySnapshot(root);
    assert.equal(snapshot.inventory.includes('ignored-private.md'), false, 'Automatic inventory must respect effective global ignores');
    const explicit = await captureRepositorySnapshot(root, undefined, ['ignored-private.md']);
    assert.ok(explicit.files.some(file => file.path === 'ignored-private.md'), 'Explicit ignored evidence remains available');
  } finally { if (prior === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = prior; }
});
