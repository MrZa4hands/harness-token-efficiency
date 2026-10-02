import { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { captureContextTask, saveContextTask, readContextTask } from '../src/context-state.mjs';

/** Own temporary check fixtures and trash only that tree after tests. */
export const projectCheckTemporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'project-check-tests-')));
after(() => assert.equal(spawnSync('trash', [projectCheckTemporaryRoot]).status, 0));
/** Isolate fixture Git from user transport, hooks and configuration. */
export const projectCheckGitEnvironment = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
/** Exact UTF-8/BOM failure data expected by check recovery assertions. */
export const projectCheckDiagnostic = '\uFEFFdiagnostic ☃: intentional failure\n' + 'protected failure details\n'.repeat(1000);

/** Create a real npm check repository with private task provenance. */
export async function checksFixture() {
  const root = await mkdtemp(join(projectCheckTemporaryRoot, 'repository-'));
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, env: projectCheckGitEnvironment });
  git(['-c', 'init.templateDir=', 'init', '--initial-branch=fixture-main']);
  git(['config', 'core.excludesFile', '/dev/null']); git(['config', 'core.attributesFile', '/dev/null']);
  await writeFile(join(root, '.gitignore'), '.check-*\n');
  await writeFile(join(root, 'fail.mjs'), "import {appendFileSync} from 'node:fs'; appendFileSync('.check-ran','ran\\n');\n" +
    'process.stderr.write(' + JSON.stringify(projectCheckDiagnostic) + ', () => process.exit(7));\n');
  await writeFile(join(root, 'empty.mjs'), 'process.exit(7);\n');
  await writeFile(join(root, 'slow.mjs'), "import {writeFileSync} from 'node:fs'; writeFileSync('.check-ready','ready');\n" +
    "process.on('SIGTERM',()=>{}); setTimeout(()=>{writeFileSync('.check-late','leaked');process.exit(0)},2000);\n");
  const manifest = { name: 'declared-check-fixture', private: true, packageManager: 'npm@11.19.1',
    scripts: { test: 'node fail.mjs', empty: 'node empty.mjs', slow: 'node slow.mjs' } };
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
  git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture: declared checks']);
  const state = await captureContextTask({ cwd: root, session_id: 'checks-session', turn_id: 'checks-turn',
    hook_event_name: 'UserPromptSubmit', prompt: 'Run the declared test check.', permission_mode: 'default' }, null);
  const stateDir = join(root, '..', 'state-' + root.split('/').at(-1)); assert.equal(await saveContextTask(stateDir, state), true);
  return { root, manifest, state, stateDir, request: { repo_root: root, state_dir: stateDir, session_id: state.session_id, checks: ['test'] } };
}

/** Refresh the same-turn fixture task after explicitly controlled edits. */
export async function refreshChecksFixture(fixture) {
  const previous = await readContextTask(fixture.request.state_dir, fixture.root, fixture.request.session_id);
  const task = await captureContextTask({ cwd: fixture.root, session_id: previous.session_id, turn_id: previous.turn_id,
    hook_event_name: 'UserPromptSubmit', prompt: previous.active_request.text, permission_mode: 'default' }, previous);
  assert.equal(await saveContextTask(fixture.request.state_dir, task), true);
}

