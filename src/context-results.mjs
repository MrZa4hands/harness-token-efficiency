import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, lstat, link, unlink } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { captureRepositorySnapshot, readContextTask } from './context-state.mjs';
import { pruneExpiredContextResult, pruneExpiredContextResults } from './context-result-expiry.mjs';

const resultHash = text => createHash('sha256').update(text).digest('hex');
const resultPath = (request, root, reference) => join(resolve(request.state_dir), resultHash(root),
  resultHash(request.session_id), 'result-' + reference + '.json');
const responseBytes = response => Buffer.byteLength(JSON.stringify(response));
const resultTaskBinding = (task, checkOutput = false) => resultHash(JSON.stringify(Object.fromEntries([
  'session_id', 'turn_id', 'request_hash', 'context_epoch', 'repo_revision', 'inventory_hash',
  'corpus_hash', 'permissions_hash', 'versions', 'expected_jev_model', 'protected_requirements',
].filter(key => !checkOutput || !['repo_revision', 'inventory_hash', 'corpus_hash'].includes(key)).map(key => [key, task[key]]))));

/** Reuse delivered context only with explicit current availability; native preparation never supplies a receipt. */
export function reuseContextDelivery(bundle, receipt, state) {
  const resend = { action: 'prefetch', reference: null };
  if (!bundle || bundle.status !== 'ok' || !/^[a-f0-9]{64}$/.test(bundle.full_result) || !receipt || !state ||
      receipt.delivery_confirmed !== true || state.context_availability !== 'confirmed' || state.history_gap ||
      !['new', 'known'].includes(state.continuity) || receipt.bundle_hash !== resultHash(JSON.stringify(bundle))) return resend;
  const keys = ['session_id', 'turn_id', 'context_epoch', 'request_hash', 'repo_revision', 'corpus_hash', 'permissions_hash'];
  if (keys.some(key => typeof state[key] !== 'string' || !state[key] || receipt[key] !== state[key]) ||
      !state.versions || JSON.stringify(receipt.versions) !== JSON.stringify(state.versions)) return resend;
  return { action: 'reuse', reference: bundle.full_result };
}

function contextResultError(request, error) {
  return { status: error.message === 'Repository context revision changed.' ? 'stale' : 'error',
    request_hash: request.request_hash ?? null, repo_revision: request.repo_revision ?? null,
    context_epoch: request.context_epoch ?? null, entries: [], coverage_status: 'partial', omissions: [],
    omitted_count: 0, next_cursor: null, full_result: null, exit_code: 1, stderr: error.message };
}

function resultCursor(reference, index, whole = false) {
  return reference + (whole ? ':whole:' : ':page:') + index;
}

/** Render whole-unit result pages without cutting private evidence; check previews yield to recovery metadata. */
export function pageContextResult(bundle, reference, cursor, byteLimit) {
  if (!Number.isSafeInteger(byteLimit) || byteLimit < 1) throw new Error('Context result byte limit rejected.');
  let index = 0; let whole = false;
  if (cursor !== undefined && cursor !== null) {
    const match = typeof cursor === 'string' && cursor.match(/^([a-f0-9]{64}):(page|whole):(0|[1-9][0-9]*)$/);
    if (!match || match[1] !== reference || !Number.isSafeInteger(Number(match[3]))) throw new Error('Context result cursor rejected.');
    index = Number(match[3]); whole = match[2] === 'whole';
    if (index >= bundle.entries.length) throw new Error('Context result cursor rejected.');
  }
  const page = { ...bundle, entries: [], omissions: [], omitted_count: bundle.entries.length - index,
    coverage_status: 'partial', next_cursor: null, full_result: reference };
  if (whole) {
    // Explicit whole-unit recovery may exceed the routine page budget; it never cuts protected evidence.
    return { ...page, entries: [bundle.entries[index]], omitted_count: 0, retrieval: 'whole-unit' };
  }
  const entryOmissions = bundle.entries.map((entry, position) => ({ path: entry.path, sha256: entry.sha256,
    reason: entry.encoding?.startsWith('base64') ? 'binary-separate-retrieval' : 'whole-unit-exceeds-page',
    byte_count: responseBytes(entry), cursor: resultCursor(reference, position, true) }));
  if (bundle.kind === 'project-check') {
    const fitsMetadata = () => entryOmissions.every((omission, position) => responseBytes({ ...page,
      omissions: [omission], next_cursor: resultCursor(reference, position) }) <= byteLimit);
    for (const key of ['stdout', 'stderr', 'error'].sort((left, right) =>
      responseBytes(page[right] ?? '') - responseBytes(page[left] ?? ''))) {
      if (fitsMetadata()) break;
      if (key !== 'error' && typeof page[key] === 'string') {
        const lines = page[key].match(/[^\n]*\n|[^\n]+$/g) ?? [];
        while (lines.length > 1 && !fitsMetadata()) { lines.pop(); page[key] = lines.join(''); }
      }
      if (fitsMetadata()) break;
      if (page[key]) page[key] = 'Full output available through full_result.';
    }
  }
  while (index < bundle.entries.length) {
    const entry = bundle.entries[index];
    const candidate = { ...page, entries: [...page.entries, entry], omitted_count: bundle.entries.length - index - 1,
      next_cursor: index + 1 < bundle.entries.length ? resultCursor(reference, index + 1) : null };
    if (!entry.encoding?.startsWith('base64') && responseBytes(candidate) <= byteLimit) { Object.assign(page, candidate); index++; continue; }
    if (page.entries.length || page.omissions.length) break;
    const omission = entryOmissions[index];
    const inventory = { ...page, omissions: [omission], next_cursor: index + 1 < bundle.entries.length
      ? resultCursor(reference, index + 1) : null };
    if (responseBytes(inventory) > byteLimit) throw new Error('Context result budget cannot hold retrieval metadata.');
    Object.assign(page, inventory); index++; break;
  }
  page.next_cursor = index < bundle.entries.length ? resultCursor(reference, index) : null;
  if (page.entries.length === bundle.entries.length && !page.omissions.length) page.coverage_status = bundle.coverage_status;
  if (responseBytes(page) > byteLimit) throw new Error('Context result budget cannot hold retrieval metadata.');
  return page;
}

async function currentResultTask(request, root, bundle) {
  const task = await readContextTask(request.state_dir, root, request.session_id);
  if (!task || task.history_gap || bundle.kind !== 'project-check' && task.repo_revision !== bundle.repo_revision ||
      task.request_hash !== bundle.request_hash || task.context_epoch !== bundle.context_epoch)
    throw new Error('Context result task binding rejected.');
  if (Object.hasOwn(request, 'execution_task') && (!request.execution_task ||
      resultTaskBinding(request.execution_task, bundle.kind === 'project-check') !== resultTaskBinding(task, bundle.kind === 'project-check')))
    throw new Error('Context result execution binding rejected.');
  return task;
}

async function readPrivateContextResult(path, reference, signal) {
  signal.throwIfAborted(); let file; let text;
  try {
    if (await realpath(path) !== path) throw new Error('Context result file rejected.');
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await file.stat();
    if (!before.isFile() || (before.mode & 0o077) !== 0 || before.size > 70_000_000 ||
        before.uid !== process.getuid()) throw new Error('Context result file rejected.');
    const bytes = await file.readFile({ signal }); const after = await file.stat(); const current = await lstat(path);
    if (['ino', 'dev', 'size', 'mtimeMs', 'ctimeMs', 'mode'].some(key => before[key] !== after[key] || after[key] !== current[key]) ||
        await realpath(path) !== path) throw new Error('Context result file changed.');
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally { await file?.close(); }
  if (resultHash(text) !== reference) throw new Error('Context result content hash rejected.');
  signal.throwIfAborted(); return text;
}

/** Persist exact context results under the current private repository/session state, then return a whole-unit page.
 * @param {object} bundle
 * @param {{repo_root:string,state_dir?:string,session_id?:string,byte_limit?:number,cursor?:string}} request
 * @returns {Promise<object>} */
export async function storeContextResult(bundle, request) {
  if (request.state_dir === undefined && request.session_id === undefined) {
    if (bundle.entries.some(entry => entry.encoding?.startsWith('base64')) || responseBytes(bundle) > (request.byte_limit ?? 6000))
      throw new Error('Context result persistence is required for continuation.');
    return bundle;
  }
  if (typeof request.state_dir !== 'string' || typeof request.session_id !== 'string') throw new Error('Context result identity rejected.');
  const root = await realpath(request.repo_root);
  const task = await currentResultTask(request, root, bundle);
  const artifact = { schema_version: 2, repo_root: root, session_id: request.session_id,
    created_at: (request.execution_task ?? task).updated_at, binding_hash: resultTaskBinding(task, bundle.kind === 'project-check'), bundle };
  const text = JSON.stringify(artifact);
  if (Buffer.byteLength(text) > 70_000_000) throw new Error('Context result storage limit exceeded.');
  const reference = resultHash(text); const path = resultPath(request, root, reference);
  try {
    if (await readPrivateContextResult(path, reference, request.signal ?? AbortSignal.timeout(2000)) !== text)
      throw new Error('Context result existing artifact rejected.');
    return pageContextResult(bundle, reference, request.cursor, request.byte_limit ?? 6000);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = join(dirname(path), '.result-' + randomUUID() + '.tmp');
  let file; let temporaryOwned = false;
  try {
    file = await open(temporary, 'wx', 0o600); temporaryOwned = true;
    await file.writeFile(text); await file.sync(); await file.close(); file = null;
    await link(temporary, path);
  }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // The producer already captured repository evidence; validate existing exact bytes without a second repository read.
    if (await readPrivateContextResult(path, reference, request.signal ?? AbortSignal.timeout(2000)) !== text)
      throw new Error('Context result existing artifact rejected.');
  }
  finally {
    await file?.close();
    if (temporaryOwned) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  return pageContextResult(bundle, reference, request.cursor, request.byte_limit ?? 6000);
}

/** Read current code evidence or historical check output bound to its original execution task identity.
 * @param {{repo_root:string,state_dir:string,session_id:string,reference:string,cursor?:string,
 * byte_limit?:number,signal?:AbortSignal}} request
 * @returns {Promise<object>} */
export async function readContext(request) {
  const signal = request.signal ?? AbortSignal.timeout(2000);
  try {
    if (!/^[a-f0-9]{64}$/.test(request.reference) || typeof request.state_dir !== 'string' ||
        typeof request.session_id !== 'string') throw new Error('Context result identity rejected.');
    signal.throwIfAborted(); const root = await realpath(request.repo_root);
    // Validate private directories and current task before touching an artifact path.
    if (!await readContextTask(request.state_dir, root, request.session_id)) throw new Error('Context result session unavailable.');
    const text = await readPrivateContextResult(resultPath(request, root, request.reference), request.reference, signal);
    const artifact = JSON.parse(text); const bundle = artifact.bundle;
    if (request.expire_results !== false && Date.parse(artifact.created_at) < Date.now() - 7 * 86400000)
      await pruneExpiredContextResult(resultPath(request, root, request.reference), resultHash(root),
        resultHash(request.session_id), AbortSignal.timeout(500), 70_000_000);
    if (artifact.schema_version !== 2 || artifact.repo_root !== root || artifact.session_id !== request.session_id ||
        !Number.isFinite(Date.parse(artifact.created_at)) || Date.parse(artifact.created_at) < Date.now() - 7 * 86400000 ||
        Date.parse(artifact.created_at) > Date.now() || !bundle ||
        !(bundle.status === 'ok' || bundle.kind === 'project-check' && ['error', 'cancelled', 'timeout', 'denied'].includes(bundle.status)) ||
        !Array.isArray(bundle.entries))
      throw new Error('Context result provenance rejected.');
    const checkOutput = bundle.kind === 'project-check';
    if (checkOutput && !bundle.entries.every(entry => entry.kind === 'check-output' && ['stdout', 'stderr'].includes(entry.stream) &&
        entry.path === entry.stream && ['utf8', 'base64'].includes(entry.encoding) && typeof entry.content === 'string' &&
        resultHash(entry.encoding === 'base64' ? Buffer.from(entry.content, 'base64') : entry.content) === entry.sha256))
      throw new Error('Context result check output rejected.');
    const paths = checkOutput ? [] : bundle.entries.filter(entry => entry.kind !== 'change' && entry.source !== 'git-blob').map(entry => entry.path);
    // Check logs describe their original execution, rather than asserting current repository contents.
    const snapshot = checkOutput ? null : await captureRepositorySnapshot(root, signal, paths);
    const currentHashes = new Map(snapshot?.files.map(file => [file.path, file.sha256]));
    if (!checkOutput && (snapshot.repo_revision !== bundle.repo_revision || bundle.entries.some(entry => entry.kind === 'change'
      ? (entry.source_sha256 !== null && currentHashes.get(entry.path) !== entry.source_sha256)
      : entry.source !== 'git-blob' && currentHashes.get(entry.path) !== entry.sha256)))
      throw new Error('Repository context revision changed.');
    const task = await currentResultTask(request, root, bundle);
    if (artifact.binding_hash !== resultTaskBinding(task, checkOutput)) throw new Error('Context result freshness binding rejected.');
    signal.throwIfAborted();
    const page = pageContextResult(bundle, request.reference, request.cursor, request.byte_limit ?? 8000);
    if (request.expire_results !== false) await pruneExpiredContextResults(
      dirname(resultPath(request, root, request.reference)), root, request.session_id, AbortSignal.timeout(500));
    return page;
  } catch (error) {
    return contextResultError(request, Object.assign(new Error(error instanceof SyntaxError ? 'Context result malformed private data rejected.'
      : error.code ? 'Context result unavailable.' : error.message), { cause: error }));
  }
}
