import fs from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPrivateTaskSnapshot, readTaskUsageTranscript, resolvePrivateTaskReference,
  readTaskJsonlSnapshot, createTaskReadBudget, retainTaskReadIdentity } from '../src/task-usage-transcript.mjs';
import { collectCompleteTaskUsage } from '../src/task-usage.mjs';

// Only absence inside an otherwise validated private root is an unavailable source, not unsafe admission.
async function resolveOptionalTaskSource(directory, path) {
  try { return await resolvePrivateTaskReference(directory, path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** Load admitted private task captures; callers may only narrow the 512 MB transcript byte budget. */
export async function loadPrivateTaskMeasurement(manifestPath, captureByteLimit = 512_000_000) {
  try {
    if (!Number.isSafeInteger(captureByteLimit) || captureByteLimit < 1 || captureByteLimit > 512_000_000) {
      throw new Error('Task usage transcript budget rejected.');
    }
    const absolute = resolve(manifestPath); const directory = dirname(absolute);
    const path = await resolvePrivateTaskReference(directory, basename(absolute));
    const snapshot = await readPrivateTaskSnapshot(path);
    const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(snapshot.data));
    if (!Array.isArray(manifest.captures) || manifest.captures.length > 128 ||
        !Array.isArray(manifest.decisions) || manifest.decisions.length > 128) throw new Error('Task usage manifest rejected.');
    let totalBytes = 0; const capturePaths = [];
    for (const descriptor of manifest.captures) {
      const capturePath = await resolveOptionalTaskSource(directory, descriptor.path);
      if (!capturePath) { capturePaths.push(null); continue; }
      const stat = await fs.lstat(capturePath); totalBytes += stat.size;
      if (stat.size > 64_000_000 || totalBytes > captureByteLimit) throw new Error('Task usage transcript budget exceeded.');
      capturePaths.push(capturePath);
    }
    const captures = [], budget = createTaskReadBudget(); let snapshotBytes = 0;
    for (let index = 0; index < capturePaths.length; index++) {
      const descriptor = manifest.captures[index];
      if (!capturePaths[index]) { captures.push({ available: false }); continue; }
      const capture = await readTaskUsageTranscript(capturePaths[index], { client_version: manifest.client_version,
        thread_id: descriptor.thread_id, root_session_id: manifest.root_session_id, root_turn_id: manifest.root_turn_id,
        root_turn_ids: manifest.root_turn_ids,
        byte_limit: Math.min(64_000_000, captureByteLimit - snapshotBytes), read_budget: budget });
      if (capture.budget_exceeded) throw new Error('Task usage record budget exceeded.');
      if (!Number.isSafeInteger(capture.snapshot_bytes) || capture.snapshot_bytes < 0) {
        throw new Error('Task usage transcript snapshot or budget rejected.');
      }
      snapshotBytes += capture.snapshot_bytes; captures.push(capture);
    }
    const decisions = [];
    for (const descriptor of manifest.decisions) {
      const decisionPath = await resolveOptionalTaskSource(directory, descriptor.path);
      if (!decisionPath) { decisions.push({ path: descriptor.path, source_sha256: null, records: null }); continue; }
      let records = [], source;
      try {
        source = await readTaskJsonlSnapshot(decisionPath, { budget, byte_limit: 4_000_000, allow_empty: true }, row => {
          if (typeof row?.decision_id === 'string') retainTaskReadIdentity(budget, 'jev-decision', row.decision_id);
          records.push(Object.fromEntries(['decision_id', 'session_id', 'turn_id', 'session_hash', 'turn_hash',
            'provider_attempts', 'provider_usage', 'versions'].filter(key => Object.hasOwn(row ?? {}, key)).map(key => [key, row[key]])));
        });
      }
      catch (error) { if (error.budget_exceeded || error.snapshot_bytes === undefined) throw error; records = null; }
      decisions.push({ path: descriptor.path, source_sha256: source?.source_sha256 ?? null, records });
    }
    const result = collectCompleteTaskUsage(manifest, captures, decisions);
    result.source_hashes = [...new Set([snapshot.source_sha256, ...result.source_hashes])].sort();
    return result;
  } catch { throw new Error('Task usage private manifest or budget rejected.'); }
}

const entry = process.argv[1] ? await fs.realpath(process.argv[1]).catch(() => null) : null;
if (entry && import.meta.url === pathToFileURL(entry).href) {
  let result;
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--manifest') throw new Error();
    result = await loadPrivateTaskMeasurement(args[1]);
    if (Buffer.byteLength(JSON.stringify(result)) > 4_000_000) throw new Error();
  } catch {
    result = collectCompleteTaskUsage(null, [], []);
    process.stderr.write('Task usage measurement rejected private input.\n');
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.task_coverage_verified ? 0 : 1;
  if (!result.task_coverage_verified) process.stderr.write('Task usage complete coverage unavailable; observed counters are partial.\n');
}
