import { captureRepositorySnapshot } from './context-state.mjs';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute, basename, extname } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { storeContextResult } from './context-results.mjs';
export { readContext } from './context-results.mjs';

const runRepositoryProcess = promisify(execFile);

async function repositoryGitBytes(root, args, signal, allowedCodes = [0]) {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0' };
  try {
    return (await runRepositoryProcess('git', ['-c', 'core.fsmonitor=false', ...args],
      { cwd: root, env, encoding: 'buffer', signal, maxBuffer: 64_000_000, timeout: 2000 })).stdout;
  } catch (error) {
    if (allowedCodes.includes(error.code) && Buffer.isBuffer(error.stdout)) return error.stdout;
    throw Object.assign(new Error('Repository context Git failed.'), { exit_code: Number.isInteger(error.code) ? error.code : 1,
      stderr: Buffer.isBuffer(error.stderr) ? new TextDecoder('utf-8', { fatal: true }).decode(error.stderr) : 'Repository context Git unavailable.' });
  }
}

function parseRepositoryObjects(text, index) {
  const entries = new Map();
  for (const row of text.split('\0').filter(Boolean)) {
    const tab = row.indexOf('\t'); const fields = row.slice(0, tab).split(' '); const path = row.slice(tab + 1);
    if (tab < 0 || !/^(100644|100755|120000)$/.test(fields[0]) ||
        !/^[a-f0-9]{40,64}$/.test(fields[index ? 1 : 2]) || (index ? fields[2] !== '0' : fields[1] !== 'blob'))
      throw new Error('Repository context object inventory rejected.');
    entries.set(path, { path, mode: fields[0], oid: fields[index ? 1 : 2] });
  }
  return entries;
}

async function repositoryCommitTree(root, commit, signal) {
  if (commit === 'unborn') return new Map();
  if (typeof commit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error('Repository context commit scope rejected.');
  const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (decode(await repositoryGitBytes(root, ['rev-parse', '--verify', commit + '^{commit}'], signal)).trim() !== commit)
    throw new Error('Repository context commit scope rejected.');
  return parseRepositoryObjects(decode(await repositoryGitBytes(root, ['ls-tree', '--full-tree', '-r', '-z', commit], signal)), false);
}

async function rawRepositoryDiff(before, after, signal) {
  const directory = await mkdtemp(join(tmpdir(), 'codex-context-diff-'));
  try {
    await writeFile(join(directory, 'before'), before, { mode: 0o600 });
    await writeFile(join(directory, 'after'), after, { mode: 0o600 });
    // Isolated raw temporary bytes avoid repository clean filters; ordinary worktree git diff/status are unsafe here.
    const output = await repositoryGitBytes(directory, ['diff', '--no-index', '--no-ext-diff', '--no-textconv',
      '--no-color', '--no-prefix', '--', 'before', 'after'], signal, [0, 1]);
    return new TextDecoder('utf-8', { fatal: true }).decode(output);
  } finally { await runRepositoryProcess('trash', [directory], { timeout: 1000 }); }
}

/** Get repository changes from raw object/index/working bytes, preserving separate staged and unstaged evidence.
 * @param {{repo_root:string,request_hash:string,repo_revision:string,context_epoch:string,
 * scope:RepositoryContextScope,cursor?:string,byte_limit?:number,state_dir?:string,session_id?:string,signal?:AbortSignal}} request
 * @returns {Promise<ContextBundle>} */
export async function getRepositoryChanges(request) {
  const signal = request.signal ?? AbortSignal.timeout(2000);
  try {
    if (!/^[a-f0-9]{64}$/.test(request.request_hash) || !/^[a-f0-9]{64}$/.test(request.repo_revision) ||
        typeof request.context_epoch !== 'string' || !request.context_epoch ||
        !['worktree', 'range'].includes(request.scope?.kind)) throw new Error('Repository context change request rejected.');
    const snapshot = await captureRepositorySnapshot(request.repo_root, signal);
    if (snapshot.repo_revision !== request.repo_revision) throw new Error('Repository context revision changed.');
    const root = snapshot.repo_root; const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const tree = commit => repositoryCommitTree(root, commit, signal);
    const stages = [];
    if (request.scope.kind === 'range') {
      stages.push({ stage: 'range', before: await tree(request.scope.base), after: await tree(request.scope.head) });
    } else {
      if (snapshot.unreadable_paths.length) throw new Error('Repository context unreadable change evidence rejected.');
      const index = parseRepositoryObjects(snapshot.index, true);
      const working = new Map(snapshot.files.map(file => [file.path, { ...file, mode: file.mode & 0o111 ? '100755' : '100644' }]));
      stages.push({ stage: 'staged', before: await tree(snapshot.head), after: index },
        { stage: 'unstaged', before: index, after: working });
    }
    const entries = []; const blobCache = new Map();
    const bytesFor = async item => {
      if (!item) return Buffer.alloc(0);
      if (!item.oid) return readRepositoryContextFile(root, item, signal);
      if (!blobCache.has(item.oid)) blobCache.set(item.oid, await repositoryGitBytes(root, ['cat-file', 'blob', item.oid], signal));
      return blobCache.get(item.oid);
    };
    for (const { stage, before, after } of stages) {
      for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
        signal.throwIfAborted(); const old = before.get(path); const current = after.get(path);
        if (old?.oid && old.oid === current?.oid && old.mode === current.mode) continue;
        const oldBytes = await bytesFor(old); const newBytes = await bytesFor(current);
        if (old && current && old.mode === current.mode && oldBytes.equals(newBytes)) continue;
        let binary = false;
        try { binary = decode(oldBytes).includes('\0') || decode(newBytes).includes('\0'); } catch { binary = true; }
        const content = binary ? JSON.stringify({ before: oldBytes.toString('base64'), after: newBytes.toString('base64') })
          : await rawRepositoryDiff(oldBytes, newBytes, signal);
        entries.push({ kind: 'change', path, stage: stage === 'unstaged' && !old ? 'untracked' : stage,
          change: !old ? 'added' : !current ? 'deleted' : old.mode !== current.mode ? 'mode-changed' : 'modified',
          old_mode: old?.mode ?? null, new_mode: current?.mode ?? null, content,
          encoding: binary ? 'base64-pair' : 'utf8', sha256: createHash('sha256').update(content).digest('hex'),
          source_sha256: snapshot.files.find(file => file.path === path)?.sha256 ?? null,
          start_line: null, end_line: null, protected: true });
      }
    }
    if ((await captureRepositorySnapshot(root, signal)).repo_revision !== snapshot.repo_revision) throw new Error('Repository context revision changed.');
    const bundle = { status: 'ok', request_hash: request.request_hash, repo_revision: request.repo_revision,
      context_epoch: request.context_epoch, scope: request.scope, entries, coverage_status: 'complete', omissions: [],
      omitted_count: 0, next_cursor: null, full_result: null, exit_code: 0, stderr: '' };
    signal.throwIfAborted(); return await storeContextResult(bundle, { ...request, byte_limit: request.byte_limit ?? 8000 });
  } catch (error) { return repositoryContextError(request, error); }
}

/** @typedef {{kind:'worktree'}|{kind:'range',base:string,head:string}} RepositoryContextScope */
/** @typedef {{status:'ok'|'error'|'stale',request_hash:string,repo_revision:string,context_epoch:string,
 * entries:object[],coverage_status:'partial'|'complete',omissions:object[],omitted_count:number,
 * next_cursor:string|null,full_result:string|null,exit_code:number,stderr:string}} ContextBundle */

function repositoryContextError(request, error) {
  return { status: error.message === 'Repository context revision changed.' ? 'stale' : 'error',
    request_hash: request.request_hash, repo_revision: request.repo_revision, context_epoch: request.context_epoch,
    entries: [], coverage_status: 'partial', omissions: [], omitted_count: 0, next_cursor: null,
    full_result: null, exit_code: Number.isInteger(error.exit_code) ? error.exit_code : 1,
    stderr: error.stderr ?? error.message };
}

async function readRepositoryContextFile(root, evidence, signal) {
  const target = resolve(root, evidence.path); const local = relative(root, target);
  if (!local || local === '..' || local.startsWith('../') || isAbsolute(local) || await realpath(target) !== target)
    throw new Error('Repository context path rejected.');
  const before = await lstat(target);
  if (!before.isFile() || before.isSymbolicLink() || before.ino !== evidence.ino || before.dev !== evidence.dev)
    throw new Error('Repository context revision changed.');
  let file;
  try {
    file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = await file.stat();
    if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev || await realpath(target) !== target)
      throw new Error('Repository context revision changed.');
    const bytes = await file.readFile({ signal }); const after = await file.stat(); const current = await lstat(target);
    if (['ino', 'dev', 'size', 'mtimeMs', 'ctimeMs', 'mode'].some(key => before[key] !== after[key] || after[key] !== current[key]) ||
        await realpath(target) !== target || createHash('sha256').update(bytes).digest('hex') !== evidence.sha256)
      throw new Error('Repository context revision changed.');
    return bytes;
  } finally { await file?.close(); }
}

function repositoryRelativeImports(root, file) {
  if (file.encoding !== 'utf8') return [];
  return [...file.content.matchAll(/\b(?:from\s*|import\s*\(?\s*)['"](\.[^'"\r\n]+)['"]/g)]
    .map(match => relative(root, resolve(root, dirname(file.path), match[1])));
}

// Search verified in-memory text on stdin; rg never reopens repository paths through a symlink race.
async function searchRepositoryContextText(files, symbols, signal) {
  if (!symbols.length) return new Set();
  const ranges = []; let line = 1;
  const input = files.map(file => {
    const text = file.content.endsWith('\n') ? file.content : file.content + '\n';
    const length = text.split('\n').length - 1;
    ranges.push({ path: file.path, first: line, last: line + length - 1 }); line += length;
    return text;
  }).join('');
  const args = ['--no-config', '--json', '--fixed-strings', ...symbols.flatMap(symbol => ['--regexp', symbol])];
  const environment = { ...process.env }; delete environment.RIPGREP_CONFIG_PATH;
  const output = await new Promise((resolveSearch, rejectSearch) => {
    const child = spawn('rg', args, { env: environment, signal, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let size = 0;
    child.once('error', rejectSearch);
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') rejectSearch(error); });
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 4_000_000) { child.kill(); rejectSearch(new Error('Repository context search output limit exceeded.')); }
      else stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', chunk => { if (Buffer.byteLength(stderr) < 32000) stderr += chunk.toString('utf8'); });
    child.once('close', code => {
      if (code === 0 || code === 1) resolveSearch(stdout);
      else rejectSearch(Object.assign(new Error('Repository context rg failed.'), { exit_code: code, stderr }));
    });
    child.stdin.end(input);
  });
  const matched = new Set();
  for (const row of output.split('\n').filter(Boolean)) {
    const result = JSON.parse(row);
    if (result.type === 'match') {
      const range = ranges.find(range => result.data.line_number >= range.first && result.data.line_number <= range.last);
      if (!range) throw new Error('Repository context search provenance rejected.');
      matched.add(range.path);
    }
  }
  return matched;
}

/** Select repository code context without dropping protected evidence or cutting fragments.
 * @param {{repo_root:string,request_hash:string,repo_revision:string,context_epoch:string,paths:string[],
 * symbols:string[],family:'code_context'|'code_review_context'|'documentation_context',scope:RepositoryContextScope,
 * exhaustive:boolean,byte_limit?:number,state_dir?:string,session_id?:string,cursor?:string,signal?:AbortSignal}} request
 * @returns {Promise<ContextBundle>} */
export async function selectCodeContext(request) {
  const signal = request.signal ?? AbortSignal.timeout(2000); const started = Date.now();
  const checkDeadline = () => { signal.throwIfAborted(); if (Date.now() - started > 2000) throw new Error('Repository context deadline exceeded.'); };
  try {
    if (!['code_context', 'code_review_context', 'documentation_context'].includes(request.family) || !['worktree', 'range'].includes(request.scope?.kind) ||
        !/^[a-f0-9]{64}$/.test(request.request_hash) || !/^[a-f0-9]{64}$/.test(request.repo_revision) ||
        typeof request.context_epoch !== 'string' || !request.context_epoch || !Array.isArray(request.paths) ||
        !request.paths.every(path => typeof path === 'string' && path && !isAbsolute(path)) ||
        !Array.isArray(request.symbols) || !request.symbols.every(symbol => typeof symbol === 'string' && symbol &&
          Buffer.byteLength(symbol) <= 512 && !/[\r\n\0]/.test(symbol)) || typeof request.exhaustive !== 'boolean' ||
        !Number.isSafeInteger(request.byte_limit ?? 6000) || (request.byte_limit ?? 6000) < 1)
      throw new Error('Repository context request rejected.');
    const snapshot = await captureRepositorySnapshot(request.repo_root, signal, request.scope.kind === 'worktree' ? request.paths : []);
    if (snapshot.repo_revision !== request.repo_revision) throw new Error('Repository context revision changed.');
    const root = snapshot.repo_root;
    let sourceFiles = snapshot.files;
    if (request.scope.kind === 'range') {
      await repositoryCommitTree(root, request.scope.base, signal);
      sourceFiles = [...(await repositoryCommitTree(root, request.scope.head, signal)).values()];
    }
    const evidence = new Map(sourceFiles.map(file => [file.path, file]));
    for (const path of request.paths) if (!evidence.has(path)) throw new Error('Repository context explicit path unavailable.');
    const files = [];
    let loadedBytes = 0;
    for (const item of sourceFiles) {
      checkDeadline();
      if (!request.paths.includes(item.path) && !/\.(?:[cm]?[jt]sx?|md|markdown|json|ya?ml|toml|py|rb|rs|go|sh)$/i.test(item.path)) continue;
      if (item.mode === '120000') { if (request.paths.includes(item.path)) throw new Error('Repository context symbolic link evidence rejected.'); continue; }
      const bytes = item.oid ? await repositoryGitBytes(root, ['cat-file', 'blob', item.oid], signal)
        : await readRepositoryContextFile(root, item, signal);
      loadedBytes += bytes.length;
      if (loadedBytes > 64_000_000) throw new Error('Repository context evidence byte limit exceeded.');
      let content; let encoding = 'utf8';
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (content.includes('\0')) throw new Error('Binary bytes'); }
      catch { content = bytes.toString('base64'); encoding = 'base64'; }
      files.push({ ...item, sha256: createHash('sha256').update(bytes).digest('hex'), content, encoding });
    }
    const byPath = new Map(files.map(file => [file.path, file]));
    const selected = new Set(request.paths);
    for (const path of await searchRepositoryContextText(files.filter(file => file.encoding === 'utf8'), request.symbols, signal)) selected.add(path);
    const stems = request.paths.map(path => basename(path, extname(path)));
    for (const file of files) {
      checkDeadline();
      if (repositoryRelativeImports(root, file).some(path => request.paths.includes(path))) selected.add(file.path);
      if (basename(file.path) === 'AGENTS.md' || ['package.json', 'tsconfig.json'].includes(file.path) ||
          ((file.path.startsWith('tests/') || file.path.startsWith('docs/')) && stems.some(stem => basename(file.path).includes(stem)))) selected.add(file.path);
    }
    for (const path of [...selected]) {
      checkDeadline(); const file = byPath.get(path);
      if (!file) throw new Error('Repository context protected path unavailable.');
      if (file.encoding !== 'utf8') continue;
      // ponytail: literal relative imports only; dynamic references keep dependency coverage partial.
      for (const local of repositoryRelativeImports(root, file)) {
        if (local === '..' || local.startsWith('../') || isAbsolute(local)) throw new Error('Repository context dependency path rejected.');
        if (byPath.has(local)) selected.add(local);
      }
    }
    const entries = [...selected].map(path => {
      const file = byPath.get(path);
      return { path, start_line: file.encoding === 'utf8' ? 1 : null,
        end_line: file.encoding === 'utf8' ? file.content.split('\n').length - (file.content.endsWith('\n') ? 1 : 0) : null,
        content: file.content, encoding: file.encoding, sha256: file.sha256, protected: true };
    });
    if (request.scope.kind === 'range') for (const entry of entries) Object.assign(entry, {
      source: 'git-blob', object_id: byPath.get(entry.path).oid, commit: request.scope.head });
    const bundle = { status: 'ok', request_hash: request.request_hash, repo_revision: request.repo_revision,
      context_epoch: request.context_epoch, scope: request.scope, entries, coverage_status: 'partial', omissions: [], omitted_count: 0,
      next_cursor: null, full_result: null, exit_code: 0, stderr: '' };
    checkDeadline();
    const final = await captureRepositorySnapshot(root, signal, request.scope.kind === 'worktree' ? request.paths : []);
    const finalFiles = new Map(final.files.map(file => [file.path, file.sha256]));
    if (final.repo_revision !== snapshot.repo_revision || (request.scope.kind === 'worktree' && entries.some(entry => finalFiles.get(entry.path) !== entry.sha256)))
      throw new Error('Repository context revision changed.');
    checkDeadline(); return await storeContextResult(bundle, request);
  } catch (error) { return repositoryContextError(request, error); }
}
