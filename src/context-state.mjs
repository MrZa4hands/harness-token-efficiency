import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { realpath, lstat, mkdir, open, rename, unlink, opendir } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import jevQuestions from '../config/jev-questions.json' with { type: 'json' };
import { validateJevContextResponse } from './jev-client.mjs';

/** @typedef {{session_id:string,turn_id:string,repo_root:string,repo_revision:string,inventory:string[],
 * request_hash:string,recent_requests:{text:string,hash:string}[],protected_requirements:string[],
 * context_epoch:string,permissions_hash:string,corpus_hash:string,versions:object,updated_at:string,
 * previous_state_hash:string|null,continuity:'new'|'known'|'unknown',expected_jev_model:string|null}} TaskState */

const runContextGit = promisify(execFile);
const contextHash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const contextFollowup = /^(?:hazlo|adelante|contin[uú]a|continue|do it|go ahead|proceed)[.!\s]*$/iu;
// ponytail: explicit scope nouns with at most four modifiers; a language parser needs measured ambiguity.
const contextExhaustive = /\b(?:exhaustive|exhaustiv[oa])\b|\ball\s+of\s+(?:them|it)\b|\b(?:all|every|entire|todos?|todas?|complete|complet[oa])\s+(?!(?:time|vez|good|right|bien|listo|now|ahora)\b)(?:[\p{L}\p{N}_$.-]+\s+){0,4}(?:files?|paths?|hunks?|changes|code|repository|project|tests?|checks?|documentation|docs|coverage|inventory|matches|occurrences?|exports?|callers?|dependencies|diagnostics?|output|evidence|reviews?|audits?|archivos?|rutas?|cambios|c[oó]digo|repositorio|proyecto|pruebas?|documentaci[oó]n|cobertura|inventario|coincidencias|ocurrencias|salida|evidencia)\b/iu;
const contextIdentityValid = value => typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= 512;

function contextPathMentioned(text, path) {
  const literal = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|[^\\p{L}\\p{N}_$./-])(?:\\./)?' + literal +
    '(?![/\\p{L}\\p{N}_$-]|\\.[\\p{L}\\p{N}_$.-])', 'u').test(text);
}

function validateContextState(state) {
  if (!state || state.schema_version !== 1 || !contextIdentityValid(state.session_id) ||
      !contextIdentityValid(state.turn_id) || typeof state.repo_root !== 'string' || !isAbsolute(state.repo_root) ||
      !['new', 'known', 'unknown'].includes(state.continuity) ||
      (state.history_gap !== undefined && typeof state.history_gap !== 'boolean') ||
      (state.expected_jev_model !== undefined && state.expected_jev_model !== null &&
        (typeof state.expected_jev_model !== 'string' || !/^[A-Za-z0-9._:/-]{1,128}$/.test(state.expected_jev_model))) ||
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
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
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
    const gap = await readPrivateContextFile(join(sessionPath, 'history-gap'));
    if (gap !== null && state.history_gap_revision !== gap) return { ...state, continuity: 'unknown', history_gap: true, history_gap_revision: gap };
    return state;
  } catch { throw new Error('Context task state rejected; baseline retained.'); }
}

/** Mark missing context history independently of a concurrent task writer's revision. */
export async function markContextHistoryGap(stateDir, repoRoot, sessionId) {
  const path = contextSessionPath(stateDir, await realpath(repoRoot), sessionId);
  await ensureContextDirectory(resolve(stateDir)); await ensureContextDirectory(dirname(path)); await ensureContextDirectory(path);
  const temporary = join(path, '.gap-' + randomUUID() + '.tmp');
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(randomUUID()); await file.sync(); }
  finally { await file.close(); }
  try { await rename(temporary, join(path, 'history-gap')); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

/** Capture a raw repository snapshot without Git conversion filters or external symlink reads.
 * @param {string} repoRoot
 * @param {AbortSignal} [signal]
 * @param {string[]} [explicitPaths] Additional explicit paths, including ignored files, checked without altering the base revision.
 * @returns {Promise<{repo_root:string,repo_revision:string,inventory:string[],inventory_hash:string,
 * unreadable_paths:string[],files:object[],head:string,index:string}>} */
export async function captureRepositorySnapshot(repoRoot, signal = AbortSignal.timeout(1800), explicitPaths = []) {
  const started = Date.now();
  const checkDeadline = () => { signal.throwIfAborted(); if (Date.now() - started > 1800) throw new Error('Context inventory deadline exceeded; baseline retained.'); };
  const root = await realpath(repoRoot);
  const environment = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0' };
  const git = async args => {
    checkDeadline();
    try {
      const result = await runContextGit('git', ['-c', 'core.fsmonitor=false', ...args],
        { cwd: root, env: environment, encoding: 'buffer', maxBuffer: 1_000_000, timeout: Math.max(1, 1800 - (Date.now() - started)), signal });
      return new TextDecoder('utf-8', { fatal: true }).decode(result.stdout);
    } catch (error) { throw new Error('Context inventory Git failed; baseline retained.', { cause: { code: error.code ?? 'invalid-output' } }); }
  };
  if ((await realpath((await git(['rev-parse', '--show-toplevel'])).trim())) !== root) throw new Error('Context repository root rejected; baseline retained.');
  // Raw index and file hashes avoid Git status, which can execute repository clean filters.
  const inventoryText = await git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  const baseInventory = new Set(inventoryText.split('\0').filter(Boolean));
  if (!Array.isArray(explicitPaths) || !explicitPaths.every(path => typeof path === 'string' && path &&
      !isAbsolute(path) && !path.includes('\0') && relative(root, resolve(root, path)) === path))
    throw new Error('Context inventory explicit path rejected; baseline retained.');
  const inventory = [...new Set([...baseInventory, ...explicitPaths])].sort();
  const readHead = () => git(['rev-parse', '--verify', '--quiet', 'HEAD']).catch(error => {
    // An unborn fixture repository has no HEAD; every other Git failure must remain visible.
    if (error.cause?.code === 1) return 'unborn'; throw error;
  });
  const head = await readHead();
  const index = await git(['ls-files', '--stage', '-z']);
  // ponytail: submodules abstain; recursive raw child snapshots require a measured pilot need.
  if (index.split('\0').some(entry => entry.startsWith('160000 '))) throw new Error('Context inventory submodule unsupported; baseline retained.');
  const contents = []; const capturedFiles = []; const unreadablePaths = []; let totalBytes = 0;
  for (const path of inventory) {
    checkDeadline();
    const target = resolve(root, path); const local = relative(root, target);
    if (local === '..' || local.startsWith('../') || isAbsolute(local)) throw new Error('Context inventory path rejected; baseline retained.');
    const stat = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) { contents.push([path, 'missing']); capturedFiles.push([target, null, false]); continue; }
    if (!stat.isFile() || stat.isSymbolicLink() || await realpath(target) !== target) {
      unreadablePaths.push(path); contents.push([path, 'unreadable', stat.mtimeMs, stat.size]);
      capturedFiles.push([target, stat, false]); continue;
    }
    let file;
    try {
      file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
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
      capturedFiles.push([target, current, true]);
    } finally { await file?.close(); }
  }
  if (inventoryText !== await git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']) ||
      index !== await git(['ls-files', '--stage', '-z']) || head !== await readHead()) throw new Error('Context inventory changed during capture; baseline retained.');
  for (const [target, before, readable] of capturedFiles) {
    checkDeadline();
    const current = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (Boolean(before) !== Boolean(current) || (before &&
        ['ino', 'dev', 'mtimeMs', 'ctimeMs', 'size', 'mode'].some(key => before[key] !== current[key])) ||
        (readable && await realpath(target) !== target)) throw new Error('Context inventory changed during capture; baseline retained.');
  }
  const hashes = new Map(contents);
  const files = capturedFiles.filter(([, , readable]) => readable).map(([target, stat]) => ({
    path: relative(root, target), sha256: hashes.get(relative(root, target)), ino: stat.ino, dev: stat.dev,
    size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, mode: stat.mode }));
  checkDeadline();
  return { repo_root: root, repo_revision: contextHash({ head, index, contents: contents.filter(([path]) => baseInventory.has(path)) }), inventory,
    inventory_hash: contextHash(inventory), unreadable_paths: unreadablePaths, files, head: head.trim(), index };
}

/** Capture context task identity and current repository evidence without following symlinks. */
export async function captureContextTask(input, previous) {
  if (!input || !contextIdentityValid(input.session_id) || typeof input.cwd !== 'string' ||
      input.hook_event_name !== 'UserPromptSubmit' || typeof input.prompt !== 'string' ||
      !input.prompt.trim() ||
      (input.turn_id !== undefined && !contextIdentityValid(input.turn_id)) ||
      input.parent_session_id === input.session_id ||
      (input.is_subagent && (!input.parent_session_id || !input.thread_id || input.thread_id === input.parent_thread_id))) {
    throw new Error('Context task identity rejected; baseline retained.');
  }
  if (Buffer.byteLength(input.prompt) > 6000) throw new Error('Context request byte limit exceeded; baseline retained.');
  const started = Date.now();
  const signal = input.signal ?? AbortSignal.timeout(1800);
  const checkDeadline = () => { signal.throwIfAborted(); if (Date.now() - started > 1800) throw new Error('Context inventory deadline exceeded; baseline retained.'); };
  const root = await realpath(input.cwd);
  if (previous) {
    validateContextState(previous);
    if (previous.repo_root !== root || previous.session_id !== input.session_id) throw new Error('Context task identity rejected; baseline retained.');
  }
  const snapshot = await captureRepositorySnapshot(root, signal);
  const { inventory, inventory_hash: inventoryHash, unreadable_paths: unreadablePaths } = snapshot;
  const knownFollowup = contextFollowup.test(input.prompt.trim());
  // ponytail: gap recovery requires a standalone explicit command; ambiguous continuations stay baseline.
  const explicitRecovery = previous?.history_gap && /^(?:inspect|review|analy[sz]e|explain|document|implement|revisa|analiza|explica|documenta|implementa)\s+/iu.test(input.prompt.trim());
  const unresolvedGap = Boolean(previous?.history_gap && !explicitRecovery);
  const continuity = unresolvedGap ? 'unknown' : knownFollowup ? (previous && previous.continuity !== 'unknown' ? 'known' : 'unknown') :
    (previous && !previous.history_gap ? 'unknown' : 'new');
  const requests = [...(previous?.recent_requests ?? []), { text: input.prompt, hash: contextHash(input.prompt) }].slice(-6);
  const explicitPaths = inventory.filter(path => {
    checkDeadline(); return contextPathMentioned(input.prompt, path) || contextPathMentioned(input.prompt, join(root, path));
  });
  const symbols = [...input.prompt.matchAll(/`([A-Za-z_$][A-Za-z0-9_$]*)`/g)].map(match => match[1]);
  const protectedRequirements = [...new Set([...(previous?.protected_requirements ?? []),
    ...explicitPaths.map(path => 'path:' + path), ...symbols.map(symbol => 'symbol:' + symbol),
    ...(contextExhaustive.test(input.prompt) ? ['exhaustive_coverage'] : [])])];
  const state = { schema_version: 1, session_id: input.session_id, turn_id: input.turn_id ?? randomUUID(),
    repo_root: root, repo_revision: snapshot.repo_revision, inventory, inventory_hash: inventoryHash,
    unreadable_paths: unreadablePaths, request_hash: contextHash(input.prompt), recent_requests: requests,
    protected_requirements: protectedRequirements, continuity, history_gap: unresolvedGap,
    expected_jev_model: previous?.expected_jev_model ?? previous?.versions.jev_model ?? null,
    ...(previous?.history_gap_revision ? { history_gap_revision: previous.history_gap_revision } : {}),
    active_request: previous && !explicitRecovery ? previous.active_request : requests.at(-1),
    context_epoch: input.context_epoch ?? (explicitRecovery ? randomUUID() : previous?.context_epoch ?? randomUUID()),
    permissions_hash: contextHash({ mode: input.permission_mode ?? 'unknown', model: input.model ?? 'unknown' }),
    corpus_hash: contextHash(input.corpus_hash ?? inventoryHash), versions: input.versions ?? {},
    updated_at: new Date().toISOString(), previous_state_hash: previous ? contextHash(previous) : null };
  checkDeadline(); return validateContextState(state);
}

/** Save context task state only when its previous revision still owns the session. */
export async function saveContextTask(stateDir, state) {
  validateContextState(state);
  const text = JSON.stringify(state) + '\n';
  if (Buffer.byteLength(text) > 1_000_000) throw new Error('Context task state byte limit exceeded; baseline retained.');
  const sessionPath = contextSessionPath(stateDir, state.repo_root, state.session_id);
  await ensureContextDirectory(resolve(stateDir));
  await ensureContextDirectory(dirname(sessionPath)); await ensureContextDirectory(sessionPath);
  const lockPath = join(sessionPath, '.task.lock'); let lock; let temporary;
  try {
    try { lock = await open(lockPath, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') return false; throw error; }
    const existing = await readContextTask(stateDir, state.repo_root, state.session_id);
    if ((existing ? contextHash(existing) : null) !== state.previous_state_hash) return false;
    const temporaryPath = join(sessionPath, '.task-' + randomUUID() + '.tmp');
    const file = await open(temporaryPath, 'wx', 0o600); temporary = temporaryPath;
    try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
    await rename(temporary, join(sessionPath, 'task.json')); temporary = null;
    return true;
  } finally {
    try { if (temporary) await unlink(temporary); }
    finally { if (lock) { try { await lock.close(); } finally { await unlink(lockPath); } } }
  }
}

/** Resolve context facts from explicit requests without treating message length as difficulty. */
export function resolveContextFacts(state) {
  const text = state.continuity === 'unknown' ? state.recent_requests.at(-1).text : state.active_request.text;
  const explicitPaths = state.protected_requirements.filter(value => value.startsWith('path:')).map(value => value.slice(5));
  const literalSymbols = state.protected_requirements.filter(value => value.startsWith('symbol:')).map(value => value.slice(7));
  const review = /\b(?:diff|changes|cambios)\b|\b(?:review|revisa|revisi[oó]n)\b(?!\s+(?:documentation|docs|documentaci[oó]n)\b)/iu.test(text);
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
  const decision = { decision_id: randomUUID(), operation, source: 'rule', action: operation === 'baseline' ? 'baseline' : 'prefetch',
    chosen_candidates: [...(facts.explicit_paths ?? [])], versions: state.versions, probabilities: {},
    fallback_reason: operation === 'baseline' ? (state.continuity === 'unknown' ? 'uncertain-continuity' : 'no-conclusive-rule') : null,
    duration_ms: 0, applied: false };
  if (operation !== 'baseline' || !jevResponse) return decision;
  if (!validateJevContextResponse(jevResponse, jevQuestions)) return { ...decision, fallback_reason: 'invalid-response' };
  const answers = jevResponse.answers;
  const yes = name => answers[name].noul >= 0.90;
  const no = name => answers[name].noul <= 0.10;
  const choice = answers.context_operation;
  const probabilities = Object.values(choice.probabilities).sort((a, b) => b - a);
  const classified = { ...decision, source: 'jev', versions: { ...state.versions, jev_model: jevResponse.model },
    probabilities: Object.fromEntries(Object.entries(answers).map(([name, answer]) => [name, answer.type === 'noul' ? answer.noul : answer.probabilities])),
    provider_usage: jevResponse.usage, provider_attempts: 1 };
  if (Object.keys(answers).filter(name => name !== 'context_operation').some(name => !yes(name) && !no(name)) ||
      choice.confidence < 0.90 || probabilities[0] < 0.90 || probabilities[0] - probabilities[1] < 0.20) {
    return { ...classified, fallback_reason: 'uncertain-classification' };
  }
  if ((facts.exhaustive && no('requires_exhaustive_coverage')) ||
      (facts.known_operation && choice.choice !== facts.known_operation) ||
      (facts.change_scope && !yes('needs_change_context')) ||
      (state.continuity === 'known' && no('continues_active_goal')) ||
      (yes('needs_change_context') && choice.choice !== 'code_review_context') ||
      (choice.choice === 'code_review_context' && !yes('needs_change_context')) ||
      (choice.choice === 'documentation_context' && !yes('needs_documentation_context')) ||
      (yes('needs_documentation_context') && !['documentation_context', 'code_review_context'].includes(choice.choice)) ||
      (choice.choice !== 'baseline' && !yes('needs_repository_context')) ||
      (choice.choice === 'baseline' && (yes('needs_repository_context') || yes('needs_change_context') || yes('needs_documentation_context')))) {
    return { ...classified, fallback_reason: 'contradictory-classification' };
  }
  if (state.continuity === 'unknown' && !yes('continues_active_goal')) return { ...classified, fallback_reason: 'new-goal-baseline' };
  return { ...classified, operation: choice.choice, action: choice.choice === 'baseline' ? 'baseline' : 'prefetch',
    fallback_reason: choice.choice === 'baseline' ? 'classified-baseline' : null };
}

/** Record an immutable context decision containing metadata only, never request text. */
export async function recordContextDecision(stateDir, state, decision, signal) {
  validateContextState(state);
  const sessionPath = contextSessionPath(stateDir, state.repo_root, state.session_id);
  await ensureContextDirectory(resolve(stateDir)); await ensureContextDirectory(dirname(sessionPath)); await ensureContextDirectory(sessionPath);
  if (!/^[a-f0-9-]{36}$/.test(decision.decision_id)) throw new Error('Context decision identity rejected; baseline retained.');
  const metadata = { schema_version: 1, decision_id: decision.decision_id, session_hash: contextHash(state.session_id),
    turn_hash: contextHash(state.turn_id), repo_hash: contextHash(state.repo_root), request_hash: state.request_hash,
    repo_revision: state.repo_revision, inventory_hash: state.inventory_hash, permissions_hash: state.permissions_hash,
    corpus_hash: state.corpus_hash, context_epoch_hash: contextHash(state.context_epoch), versions: decision.versions,
    operation: decision.operation, source: decision.source, action: decision.action,
    candidate_hashes: decision.chosen_candidates.map(contextHash), probabilities: decision.probabilities,
    fallback_reason: decision.fallback_reason, duration_ms: decision.duration_ms, provider_usage: decision.provider_usage ?? null,
    provider_attempts: decision.provider_attempts ?? 0,
    applied: false, updated_at: new Date().toISOString() };
  let file;
  try {
    file = await open(join(sessionPath, 'decision-' + decision.decision_id + '.json'), 'wx', 0o600);
    await file.writeFile(JSON.stringify(metadata) + '\n');
  } catch (error) { if (error.code === 'EEXIST') return false; throw error; }
  finally { await file?.close(); }
  // Expiration is best effort within the shared deadline and a 25 ms local cleanup budget.
  const cleanupSignal = AbortSignal.any([AbortSignal.timeout(25), ...(signal ? [signal] : [])]);
  const pruneDecisions = async (directory, sessionHash) => {
    for await (const entry of await opendir(directory)) {
      if (cleanupSignal.aborted) break;
      const name = entry.name;
      if (!/^decision-[a-f0-9-]{36}\.json$/.test(name)) continue;
      const path = join(directory, name);
      let old; try { old = JSON.parse(await readPrivateContextFile(path)); } catch { continue; }
      if (cleanupSignal.aborted) break;
      if (old && old.schema_version === 1 && old.session_hash === sessionHash && old.repo_hash === metadata.repo_hash &&
          Date.parse(old.updated_at) < Date.now() - 7 * 86400000) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  };
  const cleanup = async () => {
    await pruneDecisions(sessionPath, metadata.session_hash);
    // ponytail: opportunistic repository-local sweep, bounded to 25 ms; off never starts maintenance.
    for await (const entry of await opendir(dirname(sessionPath))) {
      if (cleanupSignal.aborted) break;
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name) || entry.name === metadata.session_hash) continue;
      const directory = join(dirname(sessionPath), entry.name); let lock;
      try {
        const stat = await lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || await realpath(directory) !== directory) continue;
        const text = await readPrivateContextFile(join(directory, 'task.json'));
        if (text !== null) {
          const task = validateContextState(JSON.parse(text));
          if (contextHash(task.repo_root) !== metadata.repo_hash || contextHash(task.session_id) !== entry.name) continue;
          if (Date.parse(task.updated_at) >= Date.now() - 7 * 86400000) continue;
          cleanupSignal.throwIfAborted();
          lock = await open(join(directory, '.task.lock'), 'wx', 0o600);
          const current = validateContextState(JSON.parse(await readPrivateContextFile(join(directory, 'task.json'))));
          if (contextHash(current.repo_root) !== metadata.repo_hash || contextHash(current.session_id) !== entry.name ||
              Date.parse(current.updated_at) >= Date.now() - 7 * 86400000) continue;
          cleanupSignal.throwIfAborted();
          await unlink(join(directory, 'task.json'));
        }
        await pruneDecisions(directory, entry.name);
      } catch { /* Untrusted, locked, or unavailable sibling entries are left intact. */ }
      finally { if (lock) { try { await lock.close(); } finally { await unlink(join(directory, '.task.lock')).catch(() => {}); } } }
    }
  };
  let abortListener;
  const interrupted = new Promise(resolve => {
    abortListener = resolve; cleanupSignal.addEventListener('abort', abortListener, { once: true });
    if (cleanupSignal.aborted) resolve();
  });
  try { await Promise.race([cleanup().catch(() => {}), interrupted]); }
  finally { cleanupSignal.removeEventListener('abort', abortListener); }
  return true;
}
