import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { captureRepositorySnapshot, readContextTask, saveContextTask } from './context-state.mjs';
import { storeContextResult, pageContextResult } from './context-results.mjs';

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
  if (['pnpm', 'bun'].includes(manager)) throw new Error('Project checks unsupported manager; no-install behavior unverified.');
  if (!manifest.scripts || typeof manifest.scripts !== 'object' || Array.isArray(manifest.scripts)) return [];
  return Object.entries(manifest.scripts).filter(([name, script]) => /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(name) &&
    typeof script === 'string' && script.trim()).map(([name]) => ({ name, command: manager, args: ['run', name] }));
}

function executeDeclaredCheck(check, root, signal) {
  return new Promise(resolveResult => {
    const streams = { stdout: [], stderr: [] }; let bytes = 0; let stopped = null; let escalation; let incomplete = false;
    // ponytail: 8 MB capture fits the 70 MB JSON artifact even at six-byte escaping; spool if real checks exceed it.
    if (signal.aborted) return resolveResult({ stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exit_code: 130,
      status: signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled', error: String(signal.reason?.message ?? 'Project check cancelled.') });
    const child = spawn(check.command, check.args, { cwd: root, shell: false, detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, COREPACK_ENABLE_NETWORK: '0' } });
    const kill = sig => {
      try { if (process.platform === 'win32') child.kill(sig); else if (child.pid) process.kill(-child.pid, sig); }
      catch (error) { if (error.code !== 'ESRCH') stopped ??= error.message; }
    };
    const stop = reason => {
      if (stopped) return; stopped = reason; kill('SIGTERM');
      escalation = setTimeout(() => {
        kill('SIGKILL');
        // Escaped process groups cannot be contained here; their inherited pipes must not prevent timeout settlement.
        if (!child.stdout.readableEnded || !child.stderr.readableEnded) {
          incomplete = true; child.stdout.destroy(); child.stderr.destroy();
        }
      }, 250);
    };
    const abort = () => stop('aborted');
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
      bytes += chunk.length;
      if (bytes <= 8_000_000) streams[stream].push(chunk);
      else stop('output-limit-exceeded');
    });
    let executionError; let observedExit;
    child.on('error', error => { executionError = error; });
    child.on('exit', code => { if (Number.isInteger(code) && code >= 0) observedExit = code; });
    child.on('close', (code, terminationSignal) => {
      // Keep escalation alive for remaining descendants even when their manager has already exited.
      if (!stopped) clearTimeout(escalation);
      signal.removeEventListener('abort', abort);
      resolveResult({ stdout: Buffer.concat(streams.stdout), stderr: Buffer.concat(streams.stderr),
        exit_code: observedExit ?? (stopped === 'aborted' ? 130 : 1),
        status: stopped === 'aborted' ? (signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled') :
          executionError?.code === 'EACCES' ? 'denied' : stopped || executionError || terminationSignal || code !== 0 ? 'error' : 'ok',
        error: stopped === 'aborted' ? String(signal.reason?.message ?? 'Project check cancelled.') :
          stopped || executionError?.message || (terminationSignal ? 'Project check terminated by ' + terminationSignal : null),
        output_complete: bytes <= 8_000_000 && !incomplete });
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
  let preview = '';
  let position = 0;
  while (position < entry.content.length) {
    const newline = entry.content.indexOf('\n', position);
    const end = newline < 0 ? entry.content.length : newline + 1;
    if (end - position > 1200) break;
    const line = entry.content.slice(position, end);
    if (Buffer.byteLength(preview + line) > 1200) break;
    preview += line; position = end;
  }
  return preview || 'Project check output exceeds preview budget; use whole-unit retrieval.';
}

async function refreshCheckTask(request, task, snapshot) {
  if (snapshot.repo_revision === task.repo_revision) return task;
  const updated = { ...task, repo_revision: snapshot.repo_revision, repo_head: snapshot.head === 'unborn' ? null : snapshot.head,
    inventory: snapshot.inventory, inventory_hash: snapshot.inventory_hash, unreadable_paths: snapshot.unreadable_paths,
    corpus_hash: task.corpus_hash === checkHash(task.inventory_hash) ? checkHash(snapshot.inventory_hash) : task.corpus_hash,
    updated_at: new Date().toISOString(), previous_state_hash: checkHash(task) };
  if (!await saveContextTask(request.state_dir, updated)) throw new Error('Project checks result state conflict.');
  return updated;
}

function projectCheckBundle(check, raw, task) {
  const entries = ['stdout', 'stderr'].map(stream => checkOutputEntry(stream, raw[stream]));
  return { kind: 'project-check', name: check.name, status: raw.status, exit_code: raw.exit_code, error: raw.error,
    output_complete: raw.output_complete ?? true, stdout: checkOutputPreview(entries[0]), stderr: checkOutputPreview(entries[1]),
    entries, omissions: [], coverage_status: raw.output_complete === false ? 'partial' : 'complete', omitted_count: 0,
    next_cursor: null, full_result: null, request_hash: task.request_hash, repo_revision: task.repo_revision,
    context_epoch: task.context_epoch };
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
  // Validate mandatory recovery metadata before executing anything; reserve space for post-execution failures.
  for (const check of selected) pageContextResult(projectCheckBundle(check, { stdout: Buffer.from([255]),
    stderr: Buffer.from([255]), status: 'cancelled', exit_code: 130, error: 'x'.repeat(512), output_complete: false }, task),
  '0'.repeat(64), null, perCheckLimit - 256);
  const results = []; let halted = false; let haltReason = 'earlier result/state failure';
  for (const check of selected) {
    if (!halted && !signal.aborted) {
      try {
        task = await refreshCheckTask(request, task, await captureRepositorySnapshot(root));
        const current = (await detectDeclaredChecks(root)).find(declaration => declaration.name === check.name);
        if (!current || current.command !== check.command || JSON.stringify(current.args) !== JSON.stringify(check.args))
          throw new Error('Project checks declaration changed; check not executed.');
      } catch (error) {
        if (!results.length) throw error; halted = true;
        haltReason = error.message?.startsWith('Project checks ') ? error.message.slice(0, 240) : 'earlier result/state failure';
      }
    }
    if (halted || signal.aborted) {
      const status = signal.aborted ? signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled' : 'error';
      results.push({ ...projectCheckBundle(check, { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), status,
        exit_code: signal.aborted ? 130 : 1, error: 'Project check not executed: ' + (signal.aborted ? status : haltReason),
        output_complete: false }, task), entries: [], executed: false, coverage_status: 'partial' });
      continue;
    }
    const raw = await executeDeclaredCheck(check, root, signal);
    const bundle = projectCheckBundle(check, raw, task);
    let result;
    try { result = await storeContextResult(bundle, { ...request, execution_task: task,
      signal: AbortSignal.timeout(2000), byte_limit: perCheckLimit - 256 }); }
    catch {
      const page = pageContextResult(bundle, '0'.repeat(64), null, perCheckLimit - 256);
      const unavailable = bundle.entries.filter(entry => !page.entries.includes(entry));
      result = { ...page, omissions: unavailable.map(entry => ({ path: entry.path, sha256: entry.sha256,
        byte_count: Buffer.byteLength(JSON.stringify(entry)), reason: 'private-persistence-unavailable', cursor: null })),
        next_cursor: null, full_result: null, coverage_status: unavailable.length ? 'partial' : bundle.coverage_status,
        omitted_count: unavailable.length, output_complete: bundle.output_complete && !unavailable.length,
        result_error: 'Project checks private output persistence failed; ' +
          (unavailable.length ? 'full output unavailable.' : 'complete output provided inline.') };
      for (const key of ['stdout', 'stderr', 'error']) {
        const entry = bundle.entries.find(entry => entry.stream === key);
        const actualText = key === 'error' ? result[key] === bundle[key] :
          entry.encoding === 'utf8' && entry.content.startsWith(result[key]);
        if (!actualText) result[key] = unavailable.length ? 'Output unavailable: private persistence failed.' : 'Complete output provided inline.';
      }
    }
    if (!result.result_error) {
      try { task = await refreshCheckTask(request, task, await captureRepositorySnapshot(root)); }
      catch { result.result_error = 'Project checks post-execution snapshot/state refresh failed.'; }
    }
    if (result.result_error && result.status === 'ok') result.status = 'error';
    results.push(result);
    halted = Boolean(result.result_error);
  }
  return results;
}
