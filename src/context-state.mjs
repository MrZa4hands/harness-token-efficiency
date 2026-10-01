import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { realpath, lstat, mkdir, open, rename, unlink, readdir } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';

/** @typedef {{session_id:string,turn_id:string,repo_root:string,repo_revision:string,inventory:string[],
 * request_hash:string,recent_requests:{text:string,hash:string}[],protected_requirements:string[],
 * context_epoch:string,permissions_hash:string,corpus_hash:string,versions:object,updated_at:string,
 * previous_state_hash:string|null,continuity:'new'|'known'|'unknown'}} TaskState */

const runContextGit = promisify(execFile);
const contextHash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const contextFollowup = /^(?:hazlo|adelante|contin[uú]a|continue|do it|go ahead|proceed)[.!\s]*$/iu;
const contextExhaustive = /\b(?:all|every|exhaustive|entire|todos?|todas?|exhaustiv[oa]|complet[oa])\b/iu;
const contextIdentityValid = value => typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= 512;

function validateContextState(state) {
  if (!state || state.schema_version !== 1 || !contextIdentityValid(state.session_id) ||
      !contextIdentityValid(state.turn_id) || typeof state.repo_root !== 'string' || !isAbsolute(state.repo_root) ||
      !['new', 'known', 'unknown'].includes(state.continuity) ||
      !['request_hash', 'repo_revision', 'inventory_hash', 'permissions_hash', 'corpus_hash'].every(key => /^[a-f0-9]{64}$/.test(state[key])) ||
      !state.active_request || typeof state.active_request.text !== 'string' || Buffer.byteLength(state.active_request.text) > 6000 ||
      state.active_request.hash !== contextHash(state.active_request.text) ||
      !Array.isArray(state.recent_requests) || state.recent_requests.length > 6 ||
      !state.recent_requests.every(request => request && typeof request.text === 'string' &&
        Buffer.byteLength(request.text) <= 6000 && request.hash === contextHash(request.text)) ||
      !Array.isArray(state.protected_requirements) || !state.protected_requirements.every(value => typeof value === 'string') ||
      !Array.isArray(state.inventory) || !state.inventory.every(value => typeof value === 'string') ||
      !Array.isArray(state.unreadable_paths) || !state.unreadable_paths.every(value => typeof value === 'string') ||
      typeof state.context_epoch !== 'string' || !state.versions || typeof state.versions !== 'object' ||
      !Number.isFinite(Date.parse(state.updated_at)) ||
      !(state.previous_state_hash === null || /^[a-f0-9]{64}$/.test(state.previous_state_hash))) {
    throw new Error('Context task state rejected; baseline retained.');
  }
  return state;
}

async function readPrivateContextFile(path) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 1_000_000) throw new Error('Unsafe private context file');
    return await file.readFile('utf8');
  } catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Context task state rejected; baseline retained.'); }
  finally { await file?.close(); }
}

function contextSessionPath(stateDir, repoRoot, sessionId) {
  if (!contextIdentityValid(sessionId) || !isAbsolute(repoRoot)) throw new Error('Context task identity rejected; baseline retained.');
  return join(resolve(stateDir), contextHash(repoRoot), contextHash(sessionId));
}

async function ensureContextDirectory(path) {
  const parent = dirname(path);
  if (parent !== path) {
    try { const stat = await lstat(parent); if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(parent) !== parent)
      throw new Error('Context state directory rejected; baseline retained.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await ensureContextDirectory(parent); }
  }
  await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error('Context state directory rejected; baseline retained.');
}

/** Read private context task state for an exact repository and session identity. */
export async function readContextTask(stateDir, repoRoot, sessionId) {
  const root = await realpath(repoRoot);
  const sessionPath = contextSessionPath(stateDir, root, sessionId);
  for (const path of [resolve(stateDir), dirname(sessionPath), sessionPath]) {
    const stat = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) return null;
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || await realpath(path) !== path)
      throw new Error('Context task state rejected; baseline retained.');
  }
  const text = await readPrivateContextFile(join(sessionPath, 'task.json'));
  if (text === null) return null;
  try {
    const state = validateContextState(JSON.parse(text));
    if (state.repo_root !== root || state.session_id !== sessionId) throw new Error('Wrong context state identity');
    if (Date.parse(state.updated_at) < Date.now() - 7 * 86400000) return null;
    return state;
  } catch { throw new Error('Context task state rejected; baseline retained.'); }
}

/** Capture context task identity and current repository evidence without following symlinks. */
export async function captureContextTask(input, previous) {
  if (!input || !contextIdentityValid(input.session_id) || typeof input.cwd !== 'string' ||
      input.hook_event_name !== 'UserPromptSubmit' || typeof input.prompt !== 'string' ||
      !input.prompt.trim() || Buffer.byteLength(input.prompt) > 6000 ||
      (input.turn_id !== undefined && !contextIdentityValid(input.turn_id)) ||
      input.parent_session_id === input.session_id ||
      (input.is_subagent && (!input.parent_session_id || !input.thread_id || input.thread_id === input.parent_thread_id))) {
    throw new Error('Context task identity rejected; baseline retained.');
  }
  const started = Date.now();
  const signal = input.signal ?? AbortSignal.timeout(1800);
  const checkDeadline = () => { signal.throwIfAborted(); if (Date.now() - started > 1800) throw new Error('Context inventory deadline exceeded; baseline retained.'); };
  const root = await realpath(input.cwd);
  const environment = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = async args => {
    checkDeadline();
    try {
      const result = await runContextGit('git', ['-c', 'core.fsmonitor=false', ...args],
        { cwd: root, env: environment, encoding: 'buffer', maxBuffer: 1_000_000, timeout: Math.max(1, 1800 - (Date.now() - started)), signal });
      return new TextDecoder('utf-8', { fatal: true }).decode(result.stdout);
    } catch (error) { throw new Error('Context inventory Git failed; baseline retained.', { cause: { code: error.code ?? 'invalid-output' } }); }
  };
  if ((await realpath((await git(['rev-parse', '--show-toplevel'])).trim())) !== root) throw new Error('Context repository root rejected; baseline retained.');
  if (previous) {
    validateContextState(previous);
    if (previous.repo_root !== root || previous.session_id !== input.session_id) throw new Error('Context task identity rejected; baseline retained.');
  }
  const inventoryText = await git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  const inventory = [...new Set(inventoryText.split('\0').filter(Boolean))].sort();
  const status = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const head = await git(['rev-parse', '--verify', '--quiet', 'HEAD']).catch(error => {
    // An unborn fixture repository has no HEAD; every other Git failure must remain visible.
    if (error.cause?.code === 1) return 'unborn'; throw error;
  });
  const index = await git(['ls-files', '--stage', '-z']);
  const contents = []; const unreadablePaths = []; let totalBytes = 0;
  for (const path of inventory) {
    checkDeadline();
    const target = resolve(root, path); const local = relative(root, target);
    if (local === '..' || local.startsWith('../') || isAbsolute(local)) throw new Error('Context inventory path rejected; baseline retained.');
    const stat = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) { contents.push([path, 'missing']); continue; }
    if (!stat.isFile() || stat.isSymbolicLink() || await realpath(target) !== target) {
      unreadablePaths.push(path); contents.push([path, 'unreadable', stat.mtimeMs, stat.size]); continue;
    }
    let file;
    try {
      file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      const before = await file.stat();
      if (!before.isFile() || before.ino !== stat.ino || before.dev !== stat.dev) throw new Error('Context inventory changed during read; baseline retained.');
      const hash = createHash('sha256'); const buffer = Buffer.alloc(65536);
      while (true) {
        checkDeadline(); const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        totalBytes += bytesRead;
        if (totalBytes > 64_000_000) throw new Error('Context inventory byte limit exceeded; baseline retained.');
        hash.update(buffer.subarray(0, bytesRead));
      }
      const after = await file.stat(); const current = await lstat(target);
      if (before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== after.size ||
          current.ino !== before.ino || current.dev !== before.dev || current.mtimeMs !== after.mtimeMs ||
          current.ctimeMs !== after.ctimeMs) throw new Error('Context inventory changed during read; baseline retained.');
      contents.push([path, hash.digest('hex')]);
    } finally { await file?.close(); }
  }
  if (inventoryText !== await git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']) ||
      status !== await git(['status', '--porcelain=v1', '-z', '--untracked-files=all']) ||
      index !== await git(['ls-files', '--stage', '-z'])) throw new Error('Context inventory changed during capture; baseline retained.');
  const knownFollowup = contextFollowup.test(input.prompt.trim());
  const continuity = knownFollowup ? (previous ? 'known' : 'unknown') : (previous ? 'unknown' : 'new');
  const requests = [...(previous?.recent_requests ?? []), { text: input.prompt, hash: contextHash(input.prompt) }].slice(-6);
  const explicitPaths = inventory.filter(path => input.prompt.includes(path));
  const symbols = [...input.prompt.matchAll(/`([A-Za-z_$][A-Za-z0-9_$]*)`/g)].map(match => match[1]);
  const protectedRequirements = [...new Set([...(previous?.protected_requirements ?? []),
    ...explicitPaths.map(path => 'path:' + path), ...symbols.map(symbol => 'symbol:' + symbol),
    ...(contextExhaustive.test(input.prompt) ? ['exhaustive_coverage'] : [])])];
  const inventoryHash = contextHash(inventory);
  const state = { schema_version: 1, session_id: input.session_id, turn_id: input.turn_id ?? randomUUID(),
    repo_root: root, repo_revision: contextHash({ head, index, status, contents }), inventory, inventory_hash: inventoryHash,
    unreadable_paths: unreadablePaths, request_hash: contextHash(input.prompt), recent_requests: requests,
    protected_requirements: protectedRequirements, continuity,
    active_request: continuity === 'known' ? previous.active_request : requests.at(-1),
    context_epoch: input.context_epoch ?? previous?.context_epoch ?? randomUUID(),
    permissions_hash: contextHash({ mode: input.permission_mode ?? 'unknown', model: input.model ?? 'unknown' }),
    corpus_hash: contextHash(input.corpus_hash ?? inventoryHash), versions: input.versions ?? {},
    updated_at: new Date().toISOString(), previous_state_hash: previous ? contextHash(previous) : null };
  return validateContextState(state);
}

/** Save context task state only when its previous revision still owns the session. */
export async function saveContextTask(stateDir, state) {
  validateContextState(state);
  const sessionPath = contextSessionPath(stateDir, state.repo_root, state.session_id);
  await ensureContextDirectory(resolve(stateDir));
  await ensureContextDirectory(dirname(sessionPath)); await ensureContextDirectory(sessionPath);
  const lockPath = join(sessionPath, '.task.lock'); let lock; let temporary;
  try {
    try { lock = await open(lockPath, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') return false; throw error; }
    const existing = await readContextTask(stateDir, state.repo_root, state.session_id);
    if ((existing ? contextHash(existing) : null) !== state.previous_state_hash) return false;
    temporary = join(sessionPath, '.task-' + randomUUID() + '.tmp');
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(state) + '\n'); await file.sync(); } finally { await file.close(); }
    await rename(temporary, join(sessionPath, 'task.json')); temporary = null;
    return true;
  } finally {
    if (temporary) await unlink(temporary);
    if (lock) { await lock.close(); await unlink(lockPath); }
  }
}

/** Resolve context facts from explicit requests without treating message length as difficulty. */
export function resolveContextFacts(state) {
  const text = state.active_request.text;
  const explicitPaths = state.protected_requirements.filter(value => value.startsWith('path:')).map(value => value.slice(5));
  const literalSymbols = state.protected_requirements.filter(value => value.startsWith('symbol:')).map(value => value.slice(7));
  const review = /\b(?:review|revisa|revisi[oó]n|diff|changes|cambios)\b/iu.test(text);
  const documentation = /\b(?:documentation|documentaci[oó]n|readme|docs)\b/iu.test(text);
  const code = /\b(?:inspect|analy[sz]e|analiza|explain|explica|c[oó]digo|code)\b/iu.test(text);
  return { explicit_paths: explicitPaths, literal_symbols: literalSymbols, change_scope: review ? { kind: 'worktree' } : null,
    exhaustive: state.protected_requirements.includes('exhaustive_coverage'), inventory_hash: state.inventory_hash,
    known_operation: review ? 'code_review_context' : documentation ? 'documentation_context' :
      code && (explicitPaths.length || literalSymbols.length) ? 'code_context' : null };
}

/** Resolve a context decision without allowing classifiers to remove protected requirements. */
export function resolveContextDecision(state, facts, jevResponse) {
  const allowed = ['code_context', 'code_review_context', 'documentation_context'];
  const operation = state.continuity !== 'unknown' && allowed.includes(facts.known_operation) ? facts.known_operation : 'baseline';
  return { decision_id: randomUUID(), operation, source: 'rule', action: operation === 'baseline' ? 'baseline' : 'prefetch',
    chosen_candidates: [...(facts.explicit_paths ?? [])], versions: state.versions, probabilities: {},
    fallback_reason: operation === 'baseline' ? (state.continuity === 'unknown' ? 'uncertain-continuity' : 'no-conclusive-rule') : null,
    duration_ms: 0, applied: false };
}

/** Record an immutable context decision containing metadata only, never request text. */
export async function recordContextDecision(stateDir, state, decision) {
  validateContextState(state);
  const sessionPath = contextSessionPath(stateDir, state.repo_root, state.session_id);
  await ensureContextDirectory(resolve(stateDir)); await ensureContextDirectory(dirname(sessionPath)); await ensureContextDirectory(sessionPath);
  if (!/^[a-f0-9-]{36}$/.test(decision.decision_id)) throw new Error('Context decision identity rejected; baseline retained.');
  const metadata = { schema_version: 1, decision_id: decision.decision_id, session_hash: contextHash(state.session_id),
    turn_hash: contextHash(state.turn_id), repo_hash: contextHash(state.repo_root), request_hash: state.request_hash,
    repo_revision: state.repo_revision, inventory_hash: state.inventory_hash, permissions_hash: state.permissions_hash,
    corpus_hash: state.corpus_hash, context_epoch_hash: contextHash(state.context_epoch), versions: state.versions,
    operation: decision.operation, source: decision.source, action: decision.action,
    candidate_hashes: decision.chosen_candidates.map(contextHash), probabilities: decision.probabilities,
    fallback_reason: decision.fallback_reason, duration_ms: decision.duration_ms, applied: false, updated_at: new Date().toISOString() };
  let file;
  try {
    file = await open(join(sessionPath, 'decision-' + decision.decision_id + '.json'), 'wx', 0o600);
    await file.writeFile(JSON.stringify(metadata) + '\n');
  } catch (error) { if (error.code === 'EEXIST') return false; throw error; }
  finally { await file?.close(); }
  // Expiration is confined to this owned session's immutable, validated metadata files.
  for (const name of await readdir(sessionPath)) {
    if (!/^decision-[a-f0-9-]{36}\.json$/.test(name)) continue;
    const path = join(sessionPath, name); const text = await readPrivateContextFile(path);
    let old; try { old = JSON.parse(text); } catch { continue; }
    if (old.schema_version === 1 && old.session_hash === metadata.session_hash && old.repo_hash === metadata.repo_hash &&
        Date.parse(old.updated_at) < Date.now() - 7 * 86400000) await unlink(path);
  }
  return true;
}
