import { readFile, writeFile, mkdir, realpath, lstat, rename, unlink, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const hookEvents = new Set(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostCompact', 'SessionStart', 'SessionEnd']);
const encodeInstallJson = value => JSON.stringify(value, null, 2) + '\n';
const quoteHookPath = value => "'" + value.replaceAll("'", "'\\''") + "'";

async function readInstallFile(path) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Context install path is not a regular file');
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
  const sourceRoot = await realpath(source_root);
  const codexDir = join(root, '.codex');
  let hooksRoot = root;
  let gitMetadata;
  try {
    gitMetadata = await lstat(join(root, '.git'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (gitMetadata?.isSymbolicLink()) throw new Error('Context install Git metadata must not be a symlink');
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
  const policyFile = await readInstallFile(policyPath);
  const receiptFile = await readInstallFile(receiptPath);
  const hooksDocument = parseInstallObject(hooksFile.text, { hooks: {} });
  const hooks = hooksDocument.hooks ?? {};
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks) ||
      Object.values(hooks).some(groups => !Array.isArray(groups))) throw new Error('Context install hooks must contain event arrays');
  hooksDocument.hooks = hooks;
  if (policyFile.text !== null) parseInstallObject(policyFile.text, null);
  const receipt = receiptFile.text === null ? null : parseInstallObject(receiptFile.text, null);
  if (receipt && (receipt.version !== 1 || receipt.source_root !== sourceRoot || (receipt.hooks_root ?? root) !== hooksRoot ||
      !Array.isArray(receipt.owned_groups))) throw new Error('Context install receipt is incompatible');
  const originalHooks = structuredClone(hooksDocument);
  let policyText = policyFile.text;
  let receiptText = receiptFile.text;
  if (action === 'install') {
    const coverageFile = await readInstallFile(join(codexDir, 'codex-context-policy-coverage.json'));
    const coverage = parseInstallObject(coverageFile.text, { events: {} });
    const template = JSON.parse(await readFile(join(sourceRoot, 'config/hooks.template.json'), 'utf8'));
    const policyProgram = await realpath(join(sourceRoot, 'src/codex-context-policy.mjs'));
    const nodePath = await realpath(process.execPath);
    const owned = receipt?.owned_groups ?? [];
    for (const [event, groups] of Object.entries(template.hooks)) {
      if (!hookEvents.has(event) || coverage.events?.[event] !== 'supported' ||
          typeof coverage.client_version !== 'string') continue;
      for (const templateGroup of groups) {
        const group = structuredClone(templateGroup);
        for (const handler of group.hooks) {
          handler.command = handler.command.replace('__NODE__', quoteHookPath(nodePath)).replace('__POLICY__', quoteHookPath(policyProgram));
        }
        const currentGroups = hooks[event] ?? [];
        if (!currentGroups.some(existing => isDeepStrictEqual(existing, group))) {
          hooks[event] = [...currentGroups, group];
          owned.push({ event, group });
        }
      }
    }
    if (policyText === null) policyText = await readFile(join(sourceRoot, 'config/context-policy.template.json'), 'utf8');
    receiptText = encodeInstallJson({ version: 1, source_root: sourceRoot, hooks_root: hooksRoot, owned_groups: owned,
      created_hooks: receipt?.created_hooks ?? hooksFile.text === null,
      created_policy_text: receipt?.created_policy_text ?? (policyFile.text === null ? policyText : null) });
  } else if (receipt) {
    for (const { event, group } of receipt.owned_groups) {
      if (!Array.isArray(hooks[event])) continue;
      hooks[event] = hooks[event].filter(existing => !isDeepStrictEqual(existing, group));
      if (hooks[event].length === 0) delete hooks[event];
    }
    if (receipt.created_policy_text === policyText) policyText = null;
    receiptText = null;
  }
  const changes = [];
  let hooksText = isDeepStrictEqual(hooksDocument, originalHooks) ? hooksFile.text : encodeInstallJson(hooksDocument);
  if (action === 'remove' && receipt?.created_hooks && Object.keys(hooks).length === 0 &&
      Object.keys(hooksDocument).every(key => key === 'hooks')) hooksText = null;
  for (const [path, before, after] of [[hooksPath, hooksFile, hooksText], [policyPath, policyFile, policyText], [receiptPath, receiptFile, receiptText]]) {
    if (before.text !== after) changes.push({ path, before, after });
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
  try {
    const preview = await prepareContextInstall(options);
    if (!options.apply || preview.changes.length === 0) return {
      changed: preview.changes.length > 0, files: preview.changes.map(change => change.path), error: null,
    };
    for (const directory of preview.directories) await mkdir(directory, { recursive: true, mode: 0o700 });
    lockPath = join(preview.hooksDir, '.codex-context-policy-install.lock');
    lock = await open(lockPath, 'wx', 0o600);
    const plan = await prepareContextInstall(options);
    for (const change of plan.changes) await applyContextInstallChange(change);
    return { changed: plan.changes.length > 0, files: plan.changes.map(change => change.path), error: null };
  } catch (error) {
    return { changed: false, files: [], error: error.code === 'EEXIST' ? 'Context installation is busy; no changes applied.' : error.message };
  } finally {
    if (lock) {
      await lock.close();
      await unlink(lockPath);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const action = args.shift();
  const options = { action, apply: false };
  let valid = true;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--apply') options.apply = true;
    else if (['--repo', '--source'].includes(flag) && args.length) options[flag === '--repo' ? 'repo_root' : 'source_root'] = args.shift();
    else valid = false;
  }
  if (!valid || !options.repo_root || !options.source_root) {
    process.stderr.write('Context installer: install|remove --repo PATH --source PATH [--apply].\n');
    process.exitCode = 1;
  } else {
    const result = await updateContextPolicyInstall(options);
    process.stdout.write(encodeInstallJson(result));
    process.exitCode = result.error ? 1 : 0;
  }
}
