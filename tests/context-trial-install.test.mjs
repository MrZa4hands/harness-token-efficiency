import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'trial-install-tests-')));
after(() => assert.equal(spawnSync('trash', [temporaryRoot]).status, 0));

// Temporary global registration must preserve foreign hooks and retain ownership until exact withdrawal succeeds.
test('temporary_trial_registration_is_additive_owned_and_reversible', async () => {
  const home = join(temporaryRoot, 'home'); await mkdir(join(home, '.codex'), { recursive: true });
  const bootstrap = join(temporaryRoot, 'isolated-home.mjs');
  await writeFile(bootstrap, "import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module';\n" +
    'os.homedir = () => ' + JSON.stringify(home) + '; syncBuiltinESMExports();\n');
  const admissionPath = join(temporaryRoot, 'admission.json');
  await writeFile(admissionPath, JSON.stringify({ version: 1, run_id: 'owner-trial' }), { mode: 0o600 });
  const foreign = { description: 'Preserved native configuration', hooks: { PreToolUse: [{ matcher: 'Bash',
    hooks: [{ type: 'command', command: 'foreign-command', timeout: 5 }] }] } };
  const hooksPath = join(home, '.codex/hooks.json');
  await writeFile(hooksPath, JSON.stringify(foreign) + '\n', { mode: 0o600 });
  const invoke = (action, apply = true) => spawnSync(process.execPath,
    ['--import', bootstrap, resolve('scripts/manage-context-trial.mjs'), action, '--admission', admissionPath, ...(apply ? ['--apply'] : [])],
    { encoding: 'utf8', timeout: 3000 });
  const before = await readFile(hooksPath, 'utf8');
  const preview = invoke('install', false);
  assert.equal(preview.status, 0, 'The temporary native trial needs a reviewable dry-run: ' + preview.stderr);
  assert.equal(await readFile(hooksPath, 'utf8'), before);
  const installed = invoke('install'); assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  const active = JSON.parse(await readFile(hooksPath, 'utf8'));
  assert.deepEqual(active.hooks.PreToolUse, foreign.hooks.PreToolUse);
  assert.equal(active.description, foreign.description);
  assert.equal(active.hooks.UserPromptSubmit.length, 1);
  assert.ok(active.hooks.UserPromptSubmit[0].hooks[0].command.includes(' trial --tasks '));
  assert.equal((await lstat(hooksPath)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(invoke('install').stdout).changed, false);
  const receiptPath = join(temporaryRoot, 'codex-context-trial-install.json');
  assert.equal((await lstat(receiptPath)).mode & 0o777, 0o600);
  const changed = structuredClone(active); changed.hooks.UserPromptSubmit[0].hooks[0].timeout = 9;
  await writeFile(hooksPath, JSON.stringify(changed));
  assert.equal(invoke('remove').status, 1, 'Edited owned definitions require reconciliation; never silently delete them');
  assert.deepEqual(JSON.parse(await readFile(hooksPath, 'utf8')), changed);
  assert.ok(await lstat(receiptPath));
  await writeFile(hooksPath, JSON.stringify(active));
  assert.equal(invoke('remove').status, 0);
  assert.deepEqual(JSON.parse(await readFile(hooksPath, 'utf8')), foreign);
  assert.equal(await lstat(receiptPath).then(() => true, error => error.code !== 'ENOENT'), false);
  await writeFile(hooksPath, 'PRIVATE_INVALID_JSON');
  const rejected = invoke('install'); assert.equal(rejected.status, 1);
  assert.equal(await readFile(hooksPath, 'utf8'), 'PRIVATE_INVALID_JSON');
  assert.ok(!rejected.stdout.includes('PRIVATE_INVALID_JSON'));
});
