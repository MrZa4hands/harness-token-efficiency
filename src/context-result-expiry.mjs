import { constants } from 'node:fs';
import { open, realpath, lstat, unlink, opendir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';

const expiryHash = value => createHash('sha256').update(value).digest('hex');

/** Remove only exact owned expired artifacts; fresh headers avoid loading complete logs.
 * Prompt maintenance validates at most 1 MB; explicit reads finish larger expiry within their deadline. */
export async function pruneExpiredContextResult(path, repoHash, sessionHash, signal, byteLimit = 1_000_000) {
  const reference = /\/result-([a-f0-9]{64})\.json$/.exec(path)?.[1];
  const temporary = /\/\.result-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/.test(path);
  if (!reference && !temporary || signal.aborted) return false;
  let file;
  try {
    if (await realpath(path) !== path) return false;
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await file.stat();
    if (!before.isFile() || (before.mode & 0o077) !== 0 || before.uid !== process.getuid() || before.size > 70_000_000) return false;
    const prefix = Buffer.alloc(Math.min(before.size, 64_000));
    const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
    signal.throwIfAborted();
    const text = prefix.subarray(0, bytesRead).toString('utf8');
    const boundary = text.indexOf(',"bundle":');
    if (boundary < 0) return false;
    const header = JSON.parse(text.slice(0, boundary) + '}');
    if (![1, 2].includes(header.schema_version) || typeof header.repo_root !== 'string' ||
        typeof header.session_id !== 'string' || expiryHash(header.repo_root) !== repoHash ||
        expiryHash(header.session_id) !== sessionHash || !Number.isFinite(Date.parse(header.created_at)) ||
        Date.parse(header.created_at) >= Date.now() - 7 * 86400000) return false;
    if (temporary) {
      if (header.schema_version !== 2 || !/^[a-f0-9]{64}$/.test(header.binding_hash) || before.mtimeMs >= Date.now() - 7 * 86400000) return false;
    } else {
      if (before.size > byteLimit) return false;
      const contents = await file.readFile({ encoding: 'utf8', signal });
      const artifact = JSON.parse(contents);
      if (![1, 2].includes(artifact.schema_version) || expiryHash(contents) !== reference ||
          typeof artifact.repo_root !== 'string' || typeof artifact.session_id !== 'string' ||
          expiryHash(artifact.repo_root) !== repoHash || expiryHash(artifact.session_id) !== sessionHash ||
          !Number.isFinite(Date.parse(artifact.created_at)) || Date.parse(artifact.created_at) >= Date.now() - 7 * 86400000) return false;
    }
    signal.throwIfAborted();
    const after = await file.stat(); const current = await lstat(path);
    if (['ino', 'dev', 'size', 'mtimeMs', 'ctimeMs', 'mode'].some(key => before[key] !== after[key] || after[key] !== current[key]) ||
        await realpath(path) !== path) return false;
    signal.throwIfAborted(); await unlink(path); return true;
  } catch { return false; }
  finally { await file?.close(); }
}

/** Finish owned large-result expiry during an explicit context read; caller supplies its existing deadline. */
export async function pruneExpiredContextResults(directory, repoRoot, sessionId, signal) {
  const repoHash = expiryHash(repoRoot);
  let removed = false;
  const pruneDirectory = async (path, sessionHash) => {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid() ||
        await realpath(path) !== path) return;
    for await (const entry of await opendir(path)) {
      if (signal.aborted) break;
      if (/^result-[a-f0-9]{64}\.json$/.test(entry.name) || /^\.result-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/.test(entry.name))
        if (await pruneExpiredContextResult(join(path, entry.name), repoHash, sessionHash, signal, 70_000_000)) {
          // ponytail: one expired artifact per explicit read; batch cleanup only if measured backlog requires it.
          removed = true; return;
        }
    }
  };
  try {
    await pruneDirectory(directory, expiryHash(sessionId));
    if (removed) return;
    // Retired sessions may have no task.json; artifact provenance remains independently verifiable.
    for await (const entry of await opendir(dirname(directory))) {
      if (signal.aborted || removed) break;
      if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name) && entry.name !== expiryHash(sessionId))
        await pruneDirectory(join(dirname(directory), entry.name), entry.name);
    }
  } catch { /* Maintenance never replaces the requested operation's result. */ }
}
