import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, realpath, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { readJevCredential, configureJevCredential } from '../src/context-credentials.mjs';

const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'context-credentials-tests-')));
after(() => assert.equal(childProcess.spawnSync('trash', [temporaryRoot]).status, 0));

// Ignoring environment precedence, exposing keys in argv, or hiding failed native access must fail here.
test('jev_credentials_use_environment_or_bounded_native_lookup', async () => {
  const originalKey = process.env.TYPESAFE_API_KEY; const originalExec = childProcess.execFile;
  const calls = [];
  try {
    process.env.TYPESAFE_API_KEY = 'SYNTHETIC_ENVIRONMENT_KEY';
    childProcess.execFile = (file, args, options, callback) => {
      calls.push({ file, args, options });
      callback(null, 'SYNTHETIC_KEYCHAIN_KEY\n', '');
    };
    syncBuiltinESMExports();
    assert.equal(await readJevCredential(), 'SYNTHETIC_ENVIRONMENT_KEY');
    assert.equal(calls.length, 0, 'An available environment key must bypass native Keychain');
    delete process.env.TYPESAFE_API_KEY;
    if (process.platform === 'darwin') {
      const signal = AbortSignal.timeout(100);
      assert.equal(await readJevCredential(signal), 'SYNTHETIC_KEYCHAIN_KEY');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].file, '/usr/bin/security');
      assert.deepEqual(calls[0].args, ['find-generic-password', '-a', 'codex-token-efficiency', '-s', 'codex-token-efficiency.typesafe-api-key', '-w']);
      assert.equal(calls[0].options.signal, signal); assert.ok(calls[0].options.timeout <= 500);
      assert.equal(JSON.stringify(calls).includes('SYNTHETIC_KEYCHAIN_KEY'), false);
      childProcess.execFile = (file, args, options, callback) => callback(Object.assign(new Error('SYNTHETIC_PRIVATE_NATIVE_ERROR'), { code: 44 }));
      syncBuiltinESMExports(); assert.equal(await readJevCredential(), null);
      childProcess.execFile = (file, args, options, callback) => callback(Object.assign(new Error('SYNTHETIC_PRIVATE_NATIVE_ERROR'), { code: 1 }));
      syncBuiltinESMExports(); await assert.rejects(readJevCredential(), /^Error: Context Jev credential lookup failed/);
    }
    process.env.TYPESAFE_API_KEY = 'bad\nheader';
    await assert.rejects(readJevCredential(), /^Error: Context Jev credential rejected/);
  } finally {
    childProcess.execFile = originalExec; syncBuiltinESMExports();
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = originalKey;
  }
});

// A piped/noninteractive install cannot create a credential prompt or partially replace native hooks.
test('noninteractive_jev_install_preserves_existing_registration', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'install-'));
  await mkdir(join(root, '.codex'));
  const hooksPath = join(root, '.codex/hooks.json');
  const original = JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'foreign-hook' }] }] } });
  await writeFile(hooksPath, original);
  const child = childProcess.spawnSync(process.execPath, [resolve('scripts/manage-context-policy.mjs'), 'install',
    '--repo', root, '--source', resolve('.'), '--apply', '--configure-jev'], {
    input: 'SYNTHETIC_PRIVATE_INPUT', encoding: 'utf8', env: { ...process.env, TYPESAFE_API_KEY: '' }, timeout: 3000 });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /interactive terminal/);
  assert.equal(child.stdout.includes('SYNTHETIC'), false); assert.equal(child.stderr.includes('SYNTHETIC'), false);
  assert.equal(await readFile(hooksPath, 'utf8'), original);
  assert.deepEqual(await readdir(join(root, '.codex')), ['hooks.json']);
});

// Native setup must prompt with -w last, never pass or echo a credential through process arguments.
test('native_jev_setup_uses_hidden_keychain_prompt', async () => {
  if (process.platform !== 'darwin') {
    await assert.rejects(configureJevCredential(), /macOS/); return;
  }
  const originalSpawn = childProcess.spawn; const originalExec = childProcess.execFile;
  const originalTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const originalKey = process.env.TYPESAFE_API_KEY; let invocation;
  try {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    process.env.TYPESAFE_API_KEY = 'SYNTHETIC_IGNORED_ENVIRONMENT_KEY';
    childProcess.spawn = (file, args, options) => {
      invocation = { file, args, options };
      const child = new EventEmitter(); process.nextTick(() => child.emit('close', 0)); return child;
    };
    childProcess.execFile = (file, args, options, callback) => callback(null, 'SYNTHETIC_STORED_KEY\n', '');
    syncBuiltinESMExports();
    assert.equal(await configureJevCredential(), 'SYNTHETIC_STORED_KEY');
    assert.equal(invocation.file, '/usr/bin/security');
    assert.deepEqual(invocation.args, ['add-generic-password', '-U', '-a', 'codex-token-efficiency',
      '-s', 'codex-token-efficiency.typesafe-api-key', '-w']);
    assert.deepEqual(invocation.options.stdio, ['inherit', 'ignore', 'inherit']);
    assert.equal(invocation.args.includes('-A'), false, 'Credential access must not be granted to every application');
    assert.equal(JSON.stringify(invocation).includes('SYNTHETIC'), false);
  } finally {
    childProcess.spawn = originalSpawn; childProcess.execFile = originalExec; syncBuiltinESMExports();
    if (originalTTY) Object.defineProperty(process.stdin, 'isTTY', originalTTY); else delete process.stdin.isTTY;
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = originalKey;
  }
});

// The executable installer must join native credential setup to model discovery without changing policy mode.
test('installer_jev_setup_keeps_credentials_out_of_hooks_and_results', async () => {
  if (process.platform !== 'darwin') return;
  const root = await mkdtemp(join(temporaryRoot, 'complete-install-'));
  await mkdir(join(root, '.codex'));
  await writeFile(join(root, '.codex/codex-context-policy-coverage.json'), JSON.stringify({
    client_version: '0.159.2', events: { UserPromptSubmit: 'supported' } }));
  const bootstrap = join(temporaryRoot, 'native-credential-fixture.mjs');
  await writeFile(bootstrap, `import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
Object.defineProperty(process.stdin, 'isTTY', { value: true });
const originalSpawn = childProcess.spawn;
const originalExec = childProcess.execFile;
childProcess.spawn = (file, args, options) => {
  if (file !== '/usr/bin/security') return originalSpawn(file, args, options);
  if (args[0] !== 'add-generic-password' || args.at(-1) !== '-w') throw new Error('Unsafe credential arguments');
  const child = new EventEmitter(); process.nextTick(() => child.emit('close', 0)); return child;
};
childProcess.execFile = (file, args, options, callback) => {
  if (file !== '/usr/bin/security') return originalExec(file, args, options, callback);
  callback(null, 'SYNTHETIC_INSTALLER_CREDENTIAL\\n', '');
};
syncBuiltinESMExports();
globalThis.fetch = async (url, options) => {
  if (url !== 'https://api.typesafe.ai/v1/models' || options.headers.Authorization !== 'Bearer SYNTHETIC_INSTALLER_CREDENTIAL')
    throw new Error('Unsafe model discovery');
  return new Response(JSON.stringify({ models: [{ name: 'jev-fixture-installer', description: 'Fixture', release_date: '2026-09-15' }] }));
};
`);
  const child = childProcess.spawnSync(process.execPath, ['--import', bootstrap, resolve('scripts/manage-context-policy.mjs'),
    'install', '--repo', root, '--source', resolve('.'), '--apply', '--configure-jev'], { encoding: 'utf8', timeout: 3000 });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.error, null); assert.equal(result.credential_updated, true);
  assert.equal(result.jev_setup.model, 'jev-fixture-installer');
  const policyText = await readFile(join(root, '.codex/codex-context-policy.json'), 'utf8');
  const policy = JSON.parse(policyText);
  assert.equal(policy.mode, 'off'); assert.equal(policy.jev_model, 'jev-fixture-installer');
  const hookText = await readFile(join(root, '.codex/hooks.json'), 'utf8');
  assert.equal(JSON.parse(hookText).hooks.UserPromptSubmit.length, 1);
  assert.equal([child.stdout, child.stderr, policyText, hookText].some(text => text.includes('SYNTHETIC_INSTALLER_CREDENTIAL')), false);
});
