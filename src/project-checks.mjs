import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { captureRepositorySnapshot, readContextTask, saveContextTask } from './context-state.mjs';
import { storeContextResult } from './context-results.mjs';

const checkHash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');

async function readCheckManifest(root) {
  const path = join(root, 'package.json'); let file;
  try {
    if (await realpath(path) !== path) throw new Error('Project checks manifest path rejected.');
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 1_000_000) throw new Error('Project checks manifest rejected.');
    return JSON.parse(await file.readFile('utf8'));
  } catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Project checks manifest rejected.'); }
  finally { await file?.close(); }
}

/** Detect declared project checks from package scripts and an unambiguous manager, or this module's documented gate. */
export async function detectDeclaredChecks(repoRoot) {
  const root = await realpath(repoRoot);
  const manifest = await readCheckManifest(root);
  if (!manifest) return root === await realpath(new URL('../', import.meta.url))
    ? [{ name: 'gate', command: process.execPath, args: ['scripts/verify-context-policy.mjs'] }] : [];
  const declared = manifest.packageManager === undefined ? null :
    typeof manifest.packageManager === 'string' && /^(npm|pnpm|yarn|bun)@\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]+)?$/.exec(manifest.packageManager)?.[1];
  const managers = new Set();
  for (const [name, manager] of [['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'],
    ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun']]) {
    const stat = await lstat(join(root, name)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat) { if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Project checks manager lockfile rejected.'); managers.add(manager); }
  }
  if (manifest.packageManager !== undefined && !declared || managers.size > 1 ||
      declared && managers.size && !managers.has(declared)) throw new Error('Project checks package manager conflict or unsupported declaration.');
  const manager = declared ?? [...managers][0];
  if (!manager) throw new Error('Project checks package manager declaration required.');
  if (!manifest.scripts || typeof manifest.scripts !== 'object' || Array.isArray(manifest.scripts)) return [];
  return Object.entries(manifest.scripts).filter(([name, script]) => /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(name) &&
    typeof script === 'string' && script.trim()).map(([name]) => ({ name, command: manager, args: ['run', name] }));
}

function executeDeclaredCheck(check, root, signal) {
  return new Promise(resolveResult => {
    const streams = { stdout: [], stderr: [] }; let bytes = 0; let stopped = null; let escalation;
    // ponytail: 8 MB capture fits the 70 MB JSON artifact even at six-byte escaping; spool if real checks exceed it.
    if (signal.aborted) return resolveResult({ stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exit_code: 130,
      status: signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled', error: String(signal.reason?.message ?? 'Project check cancelled.') });
    const child = spawn(check.command, check.args, { cwd: root, shell: false, detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, COREPACK_ENABLE_NETWORK: '0' } });
    const kill = sig => {
      try { if (process.platform === 'win32') child.kill(sig); else if (child.pid) process.kill(-child.pid, sig); }
      catch (error) { if (error.code !== 'ESRCH') stopped ??= error.message; }
    };
    const stop = reason => { if (stopped) return; stopped = reason; kill('SIGTERM'); escalation = setTimeout(() => kill('SIGKILL'), 250); };
    const abort = () => stop('aborted');
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
      bytes += chunk.length;
      if (bytes <= 8_000_000) streams[stream].push(chunk);
      else stop('output-limit-exceeded');
    });
    let executionError;
    child.on('error', error => { executionError = error; });
    child.on('close', (code, terminationSignal) => {
      // Keep escalation alive for remaining descendants even when their manager has already exited.
      if (!stopped) clearTimeout(escalation);
      signal.removeEventListener('abort', abort);
      resolveResult({ stdout: Buffer.concat(streams.stdout), stderr: Buffer.concat(streams.stderr),
        exit_code: Number.isInteger(code) && !stopped ? code : stopped === 'aborted' ? 130 : 1,
        status: stopped === 'aborted' ? (signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled') :
          executionError?.code === 'EACCES' ? 'denied' : stopped || executionError || terminationSignal || code !== 0 ? 'error' : 'ok',
        error: stopped === 'aborted' ? String(signal.reason?.message ?? 'Project check cancelled.') :
          stopped || executionError?.message || (terminationSignal ? 'Project check terminated by ' + terminationSignal : null),
        output_complete: bytes <= 8_000_000 });
    });
  });
}

function checkOutputEntry(stream, bytes) {
  return { kind: 'check-output', path: stream, stream, sha256: checkHash(bytes),
    encoding: isUtf8(bytes) ? 'utf8' : 'base64', content: isUtf8(bytes)
      ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) : bytes.toString('base64') };
}

function checkOutputPreview(entry) {
  if (!entry.content) return '';
  if (entry.encoding === 'base64') return 'Project check non-UTF-8 output: use labelled base64 whole-unit retrieval.';
  const lines = entry.content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let preview = '';
  for (const line of lines) { if (Buffer.byteLength(preview + line) > 1200) break; preview += line; }
  return preview || 'Project check output exceeds preview budget; use whole-unit retrieval.';
}

/** Run explicitly requested declared checks under ordinary tool permissions; preserve exits and privately recoverable bytes. */
export async function runProjectChecks(request) {
  const root = await realpath(request.repo_root);
  if (!Array.isArray(request.checks) || !request.checks.length || request.checks.length > 16 ||
      new Set(request.checks).size !== request.checks.length || !request.checks.every(name => typeof name === 'string'))
    throw new Error('Project checks names rejected.');
  const declarations = await detectDeclaredChecks(root);
  const selected = request.checks.map(name => declarations.find(check => check.name === name));
  if (selected.some(check => !check)) throw new Error('Project checks unknown check; nothing executed.');
  if (typeof request.state_dir !== 'string' || typeof request.session_id !== 'string') throw new Error('Project checks private task required.');
  let task = await readContextTask(request.state_dir, root, request.session_id);
  if (!task || task.history_gap) throw new Error('Project checks current task unavailable.');
  const byteLimit = request.byte_limit ?? 8000;
  const perCheckLimit = Math.floor((byteLimit - 256) / selected.length);
  if (!Number.isSafeInteger(byteLimit) || byteLimit > 8000 || perCheckLimit < 1600) throw new Error('Project checks response budget rejected; request fewer checks.');
  const timeout = request.timeout_ms ?? 120000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120000) throw new Error('Project checks timeout rejected.');
  const signal = AbortSignal.any([AbortSignal.timeout(timeout), ...(request.signal ? [request.signal] : [])]);
  const results = [];
  for (const check of selected) {
    const snapshot = await captureRepositorySnapshot(root);
    if (snapshot.repo_revision !== task.repo_revision) throw new Error('Project checks repository changed; refresh current task.');
    const raw = await executeDeclaredCheck(check, root, signal);
    const after = await captureRepositorySnapshot(root);
    if (after.repo_revision !== task.repo_revision) {
      const updated = { ...task, repo_revision: after.repo_revision, repo_head: after.head === 'unborn' ? null : after.head,
        inventory: after.inventory, inventory_hash: after.inventory_hash, unreadable_paths: after.unreadable_paths,
        updated_at: new Date().toISOString(), previous_state_hash: checkHash(task) };
      if (!await saveContextTask(request.state_dir, updated)) throw new Error('Project checks result state conflict; check already executed.');
      task = updated;
    }
    const entries = ['stdout', 'stderr'].map(stream => checkOutputEntry(stream, raw[stream]));
    const bundle = { kind: 'project-check', name: check.name, status: raw.status, exit_code: raw.exit_code, error: raw.error,
      output_complete: raw.output_complete ?? true, stdout: checkOutputPreview(entries[0]), stderr: checkOutputPreview(entries[1]),
      entries, omissions: [], coverage_status: raw.output_complete === false ? 'partial' : 'complete', omitted_count: 0, next_cursor: null, full_result: null,
      request_hash: task.request_hash, repo_revision: task.repo_revision, context_epoch: task.context_epoch };
    results.push(await storeContextResult(bundle, { ...request, byte_limit: perCheckLimit }));
    if (signal.aborted) break;
  }
  return results;
}
