import { readFile, writeFile, mkdir, realpath, lstat, rename, unlink, open, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const hookEvents = new Set(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostCompact', 'SessionStart', 'SessionEnd']);
const encodeInstallJson = value => JSON.stringify(value, null, 2) + '\n';
const quoteHookPath = value => "'" + value.replaceAll("'", "'\\''") + "'";

async function readInstallFile(path, preserveNonRegular = false) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      if (preserveNonRegular) return { text: null, mode: stat.mode & 0o777 };
      throw new Error('Context install path is not a regular file');
    }
    return { text: await readFile(path, 'utf8'), mode: stat.mode & 0o777 };
  } catch (error) {
    if (error.code === 'ENOENT') return { text: null, mode: 0o600 };
    throw error;
  }
}

function parseInstallObject(text, fallback) {
  const value = text === null ? fallback : JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Context install JSON must be an object');
  return value;
}

function contextHookIdentity(group) {
  const identity = structuredClone(group);
  for (const handler of identity.hooks ?? []) {
    if (typeof handler.command === 'string') handler.command = handler.command.replace(/ # codex-context-policy-owner=[a-f0-9]{64}$/, '');
  }
  return identity;
}

function removeOwnedHookGroup(hooks, { event, group }) {
  const groups = hooks[event];
  if (!Array.isArray(groups)) return;
  const index = groups.findIndex(existing => isDeepStrictEqual(existing, group));
  if (index !== -1) groups.splice(index, 1);
  if (groups.length === 0) delete hooks[event];
}

function resolveContextHooksRoot(root) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  let records;
  try {
    records = execFileSync('git', ['-C', root, 'worktree', 'list', '--porcelain', '-z'], {
      env, encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    }).split('\0');
  } catch {
    throw new Error('Context install cannot resolve registered Git worktrees');
  }
  if (!records.includes('worktree ' + root) || records.includes('bare') || !records[0].startsWith('worktree ')) {
    throw new Error('Context install requires a registered worktree with a primary checkout');
  }
  return records[0].slice('worktree '.length);
}

async function prepareContextInstall({ repo_root, source_root, action }) {
  if (!['install', 'remove'].includes(action)) throw new Error('Context install action must be install or remove');
  const root = await realpath(repo_root);
  let sourceRoot;
  let sourceMissing = false;
  try { sourceRoot = await realpath(source_root); }
  catch (error) {
    if (action !== 'remove' || error.code !== 'ENOENT') throw error;
    sourceRoot = resolve(source_root);
    sourceMissing = true;
  }
  const codexDir = join(root, '.codex');
  let hooksRoot = root;
  let gitMetadata;
  try {
    gitMetadata = await lstat(join(root, '.git'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (gitMetadata?.isSymbolicLink()) throw new Error('Context install Git metadata must not be a symlink');
  const gitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const repository = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {
    env: gitEnvironment, encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024,
  });
  if (repository.status === 0) {
    if (await realpath(repository.stdout.trim()) !== root) throw new Error('Context install --repo must be the Git worktree root');
  } else if (repository.error || repository.status !== 128 || gitMetadata) {
    throw new Error('Context install cannot validate the Git worktree root');
  }
  if (gitMetadata?.isFile()) hooksRoot = await realpath(resolveContextHooksRoot(root));
  const hooksDir = join(hooksRoot, '.codex');
  const directories = [...new Set([hooksDir, codexDir])];
  for (const directory of directories) {
    try {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Context install .codex directory must not be a symlink');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const hooksPath = join(hooksDir, 'hooks.json');
  const policyPath = join(codexDir, 'codex-context-policy.json');
  const receiptPath = join(codexDir, 'codex-context-policy-install.json');
  const hooksFile = await readInstallFile(hooksPath);
  const policyFile = await readInstallFile(policyPath, action === 'remove');
  const receiptFile = await readInstallFile(receiptPath);
  const hooksDocument = parseInstallObject(hooksFile.text, { hooks: {} });
  const hooks = hooksDocument.hooks ?? {};
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks) ||
      Object.values(hooks).some(groups => !Array.isArray(groups))) throw new Error('Context install hooks must contain event arrays');
  hooksDocument.hooks = hooks;
  if (action === 'install' && policyFile.text !== null) parseInstallObject(policyFile.text, null);
  const receipt = receiptFile.text === null ? null : parseInstallObject(receiptFile.text, null);
  if (sourceMissing && receipt?.source_path === resolve(source_root)) sourceRoot = receipt.source_root;
  if (receipt && (receipt.version !== 1 || receipt.source_root !== sourceRoot || (receipt.hooks_root ?? root) !== hooksRoot ||
      !Array.isArray(receipt.owned_groups))) throw new Error('Context install receipt is incompatible');
  for (const { event, group } of receipt?.owned_groups ?? []) {
    const groups = hooks[event] ?? [];
    if (groups.some(existing => isDeepStrictEqual(existing, group))) continue;
    const commands = new Set(group.hooks.map(handler => handler.command));
    const ownerMarker = group.hooks.map(handler => handler.command?.match(/ # codex-context-policy-owner=[a-f0-9]{64}$/)?.[0]).find(Boolean);
    if (Object.values(hooks).some(eventGroups => eventGroups.some(existing => existing.hooks?.some(handler =>
      commands.has(handler.command) || (ownerMarker && typeof handler.command === 'string' && handler.command.includes(ownerMarker)))))) {
      throw new Error('Context install owned hook was modified; preserve it and reconcile its definition before retrying.');
    }
  }
  const originalHooks = structuredClone(hooksDocument);
  let policyText = policyFile.text;
  let receiptText = receiptFile.text;
  let completedReceiptText;
  if (action === 'install') {
    const coverageFile = await readInstallFile(join(codexDir, 'codex-context-policy-coverage.json'));
    const coverage = parseInstallObject(coverageFile.text, { events: {} });
    const template = JSON.parse(await readFile(join(sourceRoot, 'config/hooks.template.json'), 'utf8'));
    const policyProgram = await realpath(join(sourceRoot, 'src/codex-context-policy.mjs'));
    const nodePath = await realpath(process.execPath);
    const owned = receipt?.owned_groups ?? [];
    const desired = [];
    for (const [event, groups] of Object.entries(template.hooks)) {
      if (!hookEvents.has(event) || coverage.events?.[event] !== 'supported' ||
          typeof coverage.client_version !== 'string') continue;
      for (const templateGroup of groups) {
        const group = structuredClone(templateGroup);
        for (const handler of group.hooks) {
          handler.command = handler.command.replace('__NODE__', () => quoteHookPath(nodePath)).replace('__POLICY__', () => quoteHookPath(policyProgram));
          handler.command += ' # codex-context-policy-owner=' + createHash('sha256').update(root).digest('hex');
        }
        desired.push({ event, group });
      }
    }
    // Keep prior ownership durable until the corresponding hook rewrite succeeds.
    for (const entry of owned) {
      if (desired.some(current => current.event === entry.event && isDeepStrictEqual(current.group, entry.group))) continue;
      removeOwnedHookGroup(hooks, entry);
    }
    for (const { event, group } of desired) {
      const currentGroups = hooks[event] ?? [];
      const alreadyOwned = owned.some(entry => entry.event === event && isDeepStrictEqual(entry.group, group));
      if (!alreadyOwned && currentGroups.some(existing => isDeepStrictEqual(contextHookIdentity(existing), contextHookIdentity(group)))) {
        throw new Error('Context install hook belongs to another installation; remove its owning installation before retrying.');
      }
      if (!currentGroups.some(existing => isDeepStrictEqual(existing, group))) {
        hooks[event] = [...currentGroups, group];
        if (!alreadyOwned) owned.push({ event, group });
      }
    }
    if (policyText === null) policyText = await readFile(join(sourceRoot, 'config/context-policy.template.json'), 'utf8');
    const receiptDocument = { version: 1, source_root: sourceRoot, source_path: receipt?.source_path ?? resolve(source_root), hooks_root: hooksRoot, owned_groups: owned,
      created_hooks: receipt?.created_hooks ?? hooksFile.text === null,
      created_policy_text: receipt?.created_policy_text ?? (policyFile.text === null ? policyText : null) };
    receiptText = encodeInstallJson(receiptDocument);
    completedReceiptText = encodeInstallJson({ ...receiptDocument, owned_groups: desired });
  } else if (receipt) {
    for (const entry of receipt.owned_groups) removeOwnedHookGroup(hooks, entry);
    if (receipt.created_policy_text === policyText) policyText = null;
    receiptText = null;
  }
  const changes = [];
  let hooksText = isDeepStrictEqual(hooksDocument, originalHooks) ? hooksFile.text : encodeInstallJson(hooksDocument);
  if (action === 'remove' && receipt?.created_hooks && Object.keys(hooks).length === 0 &&
      Object.keys(hooksDocument).every(key => key === 'hooks')) hooksText = null;
  const orderedFiles = action === 'install'
    ? [[receiptPath, receiptFile, receiptText], [policyPath, policyFile, policyText], [hooksPath, hooksFile, hooksText]]
    : [[hooksPath, hooksFile, hooksText], [policyPath, policyFile, policyText], [receiptPath, receiptFile, receiptText]];
  for (const [path, before, after] of orderedFiles) {
    if (before.text !== after) changes.push({ path, before, after });
  }
  if (completedReceiptText !== undefined && completedReceiptText !== receiptText) {
    changes.push({ path: receiptPath, before: { ...receiptFile, text: receiptText }, after: completedReceiptText });
  }
  return { hooksDir, directories, changes };
}

async function applyContextInstallChange(change) {
  const current = await readInstallFile(change.path);
  if (current.text !== change.before.text) throw new Error('Context install concurrent change detected');
  if (change.after === null) {
    await unlink(change.path);
    return;
  }
  const temporary = change.path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, change.after, { flag: 'wx', mode: change.before.mode });
    await chmod(temporary, change.before.mode);
    const beforeRename = await readInstallFile(change.path);
    if (beforeRename.text !== change.before.text) throw new Error('Context install concurrent change detected');
    await rename(temporary, change.path);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** Add or remove owned context hooks in the primary checkout; policy stays local and writes require apply. */
export async function updateContextPolicyInstall(options) {
  let lock;
  let lockPath;
  let result;
  const appliedFiles = [];
  try {
    const preview = await prepareContextInstall(options);
    if (!options.apply || preview.changes.length === 0) return result = {
      changed: preview.changes.length > 0, files: [...new Set(preview.changes.map(change => change.path))], error: null,
    };
    for (const directory of preview.directories) await mkdir(directory, { recursive: true, mode: 0o700 });
    lockPath = join(preview.hooksDir, '.codex-context-policy-install.lock');
    lock = await open(lockPath, 'wx', 0o600);
    const plan = await prepareContextInstall(options);
    for (const change of plan.changes) {
      await applyContextInstallChange(change);
      appliedFiles.push(change.path);
    }
    return result = { changed: plan.changes.length > 0, files: [...new Set(appliedFiles)], error: null };
  } catch (error) {
    return result = { changed: appliedFiles.length > 0, files: [...new Set(appliedFiles)], error: error instanceof SyntaxError
      ? 'Context installation rejected malformed JSON; original files preserved.'
      : error.code === 'EEXIST' ? 'Context installation is busy: ' + lockPath + '. Verify no installer is running before moving an abandoned lock to Trash.' : error.message };
  } finally {
    if (lock) {
      try { await lock.close(); }
      catch { result.error = [result.error, 'Context installation lock close failed: ' + lockPath].filter(Boolean).join(' '); }
      try { await unlink(lockPath); }
      catch (error) {
        if (error.code !== 'ENOENT') result.error = [result.error, 'Context installation lock release failed: ' + lockPath].filter(Boolean).join(' ');
      }
    }
  }
}

const installEntryPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
if (installEntryPath && import.meta.url === pathToFileURL(installEntryPath).href) {
  const args = process.argv.slice(2);
  const action = args.shift();
  const options = { action, apply: false };
  let configureJev = false;
  let valid = true;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--apply') options.apply = true;
    else if (flag === '--configure-jev' && !configureJev) configureJev = true;
    else if (['--repo', '--source'].includes(flag) && args.length) options[flag === '--repo' ? 'repo_root' : 'source_root'] = args.shift();
    else valid = false;
  }
  if (!valid || !options.repo_root || !options.source_root || (configureJev && action !== 'install')) {
    process.stderr.write('Context installer: install|remove --repo PATH --source PATH [--apply] [--configure-jev].\n');
    process.exitCode = 1;
  } else if (configureJev && options.apply && !process.stdin.isTTY) {
    process.stderr.write('Context installer Jev setup requires an interactive terminal; registration preserved.\n');
    process.exitCode = 1;
  } else {
    const result = await updateContextPolicyInstall(options);
    if (!result.error && configureJev) {
      result.jev_setup = { status: options.apply ? 'pending' : 'requires-apply', credential_store: 'macOS Keychain' };
      if (options.apply) {
        try {
          const { configureJevCredential } = await import('../src/context-credentials.mjs');
          const { configureJevModel } = await import('../src/jev-client.mjs');
          const apiKey = await configureJevCredential();
          result.credential_updated = true; result.changed = true;
          const setup = await configureJevModel(options.repo_root, { apiKey });
          result.jev_setup = { ...setup, credential_store: 'macOS Keychain' };
          if (setup.status === 'ok') result.files = [...new Set([...result.files,
            join(await realpath(options.repo_root), '.codex/codex-context-policy.json')])];
          else result.error = 'Context installer Jev model discovery failed: ' + setup.fallback_reason + '; existing policy mode retained.';
        } catch {
          result.error = 'Context installer Jev setup failed; hook changes above may have been applied. No credential was exported.';
        }
      }
    }
    process.stdout.write(encodeInstallJson(result));
    process.exitCode = result.error ? 1 : 0;
  }
}
