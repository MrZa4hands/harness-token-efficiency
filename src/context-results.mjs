import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { captureRepositorySnapshot, readContextTask } from './context-state.mjs';

const resultHash = text => createHash('sha256').update(text).digest('hex');
const resultPath = (request, root, reference) => join(resolve(request.state_dir), resultHash(root),
  resultHash(request.session_id), 'result-' + reference + '.json');
const responseBytes = response => Buffer.byteLength(JSON.stringify(response));

function contextResultError(request, error) {
  return { status: error.message === 'Repository context revision changed.' ? 'stale' : 'error',
    request_hash: request.request_hash ?? null, repo_revision: request.repo_revision ?? null,
    context_epoch: request.context_epoch ?? null, entries: [], coverage_status: 'partial', omissions: [],
    omitted_count: 0, next_cursor: null, full_result: null, exit_code: 1, stderr: error.message };
}

function resultCursor(reference, index, whole = false) {
  return reference + (whole ? ':whole:' : ':page:') + index;
}

function pageContextResult(bundle, reference, cursor, byteLimit) {
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
  while (index < bundle.entries.length) {
    const entry = bundle.entries[index];
    const candidate = { ...page, entries: [...page.entries, entry], omitted_count: bundle.entries.length - index - 1,
      next_cursor: index + 1 < bundle.entries.length ? resultCursor(reference, index + 1) : null };
    if (!entry.encoding?.startsWith('base64') && responseBytes(candidate) <= byteLimit) { Object.assign(page, candidate); index++; continue; }
    if (page.entries.length || page.omissions.length) break;
    const omission = { path: entry.path, sha256: entry.sha256, reason: entry.encoding?.startsWith('base64') ? 'binary-separate-retrieval' : 'whole-unit-exceeds-page',
      byte_count: responseBytes(entry), cursor: resultCursor(reference, index, true) };
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
  if (!task || task.history_gap || task.repo_revision !== bundle.repo_revision ||
      task.request_hash !== bundle.request_hash || task.context_epoch !== bundle.context_epoch)
    throw new Error('Context result task binding rejected.');
  return task;
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
  await currentResultTask(request, root, bundle);
  const artifact = { schema_version: 1, repo_root: root, session_id: request.session_id,
    created_at: new Date().toISOString(), bundle };
  const text = JSON.stringify(artifact);
  if (Buffer.byteLength(text) > 70_000_000) throw new Error('Context result storage limit exceeded.');
  const reference = resultHash(text); const path = resultPath(request, root, reference);
  let file;
  try { file = await open(path, 'wx', 0o600); await file.writeFile(text); await file.sync(); }
  finally { await file?.close(); }
  return pageContextResult(bundle, reference, request.cursor, request.byte_limit ?? 6000);
}

/** Read private context results only for their current repository, session, revision and task epoch.
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
    const path = resultPath(request, root, request.reference); let file; let text;
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
    if (resultHash(text) !== request.reference) throw new Error('Context result content hash rejected.');
    const artifact = JSON.parse(text); const bundle = artifact.bundle;
    if (artifact.schema_version !== 1 || artifact.repo_root !== root || artifact.session_id !== request.session_id ||
        !Number.isFinite(Date.parse(artifact.created_at)) || Date.parse(artifact.created_at) < Date.now() - 7 * 86400000 ||
        Date.parse(artifact.created_at) > Date.now() || !bundle || bundle.status !== 'ok' || !Array.isArray(bundle.entries))
      throw new Error('Context result provenance rejected.');
    const paths = bundle.entries.filter(entry => entry.kind !== 'change' && entry.source !== 'git-blob').map(entry => entry.path);
    const snapshot = await captureRepositorySnapshot(root, signal, paths);
    const currentHashes = new Map(snapshot.files.map(file => [file.path, file.sha256]));
    if (snapshot.repo_revision !== bundle.repo_revision || bundle.entries.some(entry => entry.kind === 'change'
      ? (entry.source_sha256 !== null && currentHashes.get(entry.path) !== entry.source_sha256)
      : entry.source !== 'git-blob' && currentHashes.get(entry.path) !== entry.sha256))
      throw new Error('Repository context revision changed.');
    await currentResultTask(request, root, bundle); signal.throwIfAborted();
    return pageContextResult(bundle, request.reference, request.cursor, request.byte_limit ?? 8000);
  } catch (error) {
    return contextResultError(request, Object.assign(new Error(error instanceof SyntaxError ? 'Context result malformed private data rejected.'
      : error.code ? 'Context result unavailable.' : error.message), { cause: error }));
  }
}
