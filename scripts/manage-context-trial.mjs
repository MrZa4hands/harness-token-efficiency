import { open, realpath, lstat, mkdir, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { applyContextInstallChange } from './manage-context-policy.mjs';

const encode = value => JSON.stringify(value, null, 2) + '\n';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

async function readTrialInstallFile(path) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.size > 4_000_000) throw new Error('Context trial installation file rejected.');
    const bytes = await file.readFile();
    if (bytes.length > 4_000_000) throw new Error('Context trial installation file exceeds limit.');
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), mode: stat.mode & 0o777 };
  } catch (error) {
    if (error.code === 'ENOENT') return { text: null, mode: 0o600 };
    throw error;
  } finally { await file?.close(); }
}

/** Register or withdraw one temporary native trial hook; preserve foreign groups and require native trust separately.
 * @param {{action:'install'|'remove',admission:string,apply:boolean}} options
 * @returns {Promise<{changed:boolean,files:string[],error:string|null}>} */
export async function updateContextTrialInstall(options) {
  let lock; let lockPath; let result; const files = [];
  try {
    if (!['install', 'remove'].includes(options.action)) throw new Error('Context trial installation action rejected.');
    const admission = resolve(options.admission);
    const trialDirectory = dirname(admission); const sourceRoot = await realpath(new URL('../', import.meta.url));
    const trialStat = await lstat(trialDirectory);
    if (!trialStat.isDirectory() || trialStat.isSymbolicLink() || trialStat.uid !== process.getuid() ||
        (trialStat.mode & 0o077) !== 0 || await realpath(trialDirectory) !== trialDirectory) throw new Error('Context trial installation directory must be private.');
    if (options.action === 'install') {
      const declaration = await readTrialInstallFile(admission);
      if (declaration.text === null || (declaration.mode & 0o077) !== 0 || JSON.parse(declaration.text)?.version !== 1)
        throw new Error('Context trial installation admission rejected.');
    }
    const nativeDirectory = join(await realpath(homedir()), '.codex');
    const nativeStat = await lstat(nativeDirectory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (nativeStat && (!nativeStat.isDirectory() || nativeStat.isSymbolicLink() || await realpath(nativeDirectory) !== nativeDirectory))
      throw new Error('Context trial native directory rejected.');
    const hooksPath = join(nativeDirectory, 'hooks.json');
    const receiptPath = join(trialDirectory, 'codex-context-trial-install.json');
    const marker = ' # codex-context-trial-owner=' + createHash('sha256').update(admission).digest('hex');
    const group = { hooks: [{ type: 'command', command: quote(await realpath(process.execPath)) + ' ' +
      quote(join(sourceRoot, 'src/pilot-evaluation.mjs')) + ' trial --tasks ' + quote(join(sourceRoot, 'evaluation/tasks.jsonl')) +
      ' --admission ' + quote(admission) + marker, timeout: 3, additionalContextLimit: 2000 }] };
    const prepare = async () => {
      const beforeHooks = await readTrialInstallFile(hooksPath); const beforeReceipt = await readTrialInstallFile(receiptPath);
      const document = beforeHooks.text === null ? { hooks: {} } : JSON.parse(beforeHooks.text);
      if (!document || typeof document !== 'object' || Array.isArray(document) ||
          !document.hooks || typeof document.hooks !== 'object' || Array.isArray(document.hooks) ||
          Object.values(document.hooks).some(value => !Array.isArray(value))) throw new Error('Context trial native hooks rejected.');
      const original = structuredClone(document);
      const receipt = beforeReceipt.text === null ? null : JSON.parse(beforeReceipt.text);
      if (receipt && ((beforeReceipt.mode & 0o077) !== 0 || receipt.version !== 1 || receipt.source_root !== sourceRoot ||
          receipt.admission !== admission || receipt.hooks_path !== hooksPath || !isDeepStrictEqual(receipt.group, group)))
        throw new Error('Context trial installation ownership rejected.');
      const groups = document.hooks.UserPromptSubmit ?? [];
      const exact = groups.findIndex(existing => isDeepStrictEqual(existing, group));
      const marked = Object.values(document.hooks).some(groups => groups.some(existing =>
        existing.hooks?.some(handler => typeof handler.command === 'string' && handler.command.includes(marker))));
      if ((marked && exact === -1) || (!receipt && marked)) throw new Error('Context trial owned definition modified or foreign; preserved.');
      let nextReceipt = beforeReceipt.text;
      if (options.action === 'install') {
        if (exact === -1) document.hooks.UserPromptSubmit = [...groups, group];
        nextReceipt = encode(receipt ?? { version: 1, source_root: sourceRoot, admission, hooks_path: hooksPath, group,
          created_hooks: beforeHooks.text === null });
      } else if (receipt) {
        if (exact !== -1) groups.splice(exact, 1);
        if (!groups.length) delete document.hooks.UserPromptSubmit;
        nextReceipt = null;
      }
      const nextHooks = isDeepStrictEqual(original, document) ? beforeHooks.text :
        options.action === 'remove' && receipt?.created_hooks && !Object.keys(document.hooks).length &&
          Object.keys(document).every(key => key === 'hooks') ? null : encode(document);
      const hookChange = { path: hooksPath, before: beforeHooks, after: nextHooks };
      const receiptChange = { path: receiptPath, before: beforeReceipt, after: nextReceipt };
      return (options.action === 'install' ? [receiptChange, hookChange] : [hookChange, receiptChange])
        .filter(change => change.before.text !== change.after);
    };
    const preview = await prepare();
    if (!options.apply || !preview.length) return result = { changed: preview.length > 0, files: preview.map(change => change.path), error: null };
    await mkdir(nativeDirectory, { recursive: true, mode: 0o700 });
    lockPath = join(nativeDirectory, '.codex-context-policy-install.lock'); lock = await open(lockPath, 'wx', 0o600);
    for (const change of await prepare()) { await applyContextInstallChange(change); files.push(change.path); }
    return result = { changed: files.length > 0, files, error: null };
  } catch (error) {
    return result = { changed: files.length > 0, files, error: error instanceof SyntaxError
      ? 'Context trial malformed private configuration rejected.' : error.code ? 'Context trial installation file or lock unavailable.' : error.message };
  } finally {
    if (lock) {
      try { await lock.close(); } catch { result.error = [result.error, 'Context trial installation lock close failed.'].filter(Boolean).join(' '); }
      try { await unlink(lockPath); } catch (error) {
        if (error.code !== 'ENOENT') result.error = [result.error, 'Context trial installation lock release failed.'].filter(Boolean).join(' ');
      }
    }
  }
}

const entryPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  const [action, flag, admission, apply] = process.argv.slice(2);
  const result = flag === '--admission' && admission && (apply === undefined || apply === '--apply') && process.argv.length <= 6
    ? await updateContextTrialInstall({ action, admission, apply: apply === '--apply' })
    : { changed: false, files: [], error: 'Context trial installation arguments rejected.' };
  process.stdout.write(encode(result)); process.exitCode = result.error ? 1 : 0;
}
