import fs from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPrivateTaskSnapshot, readTaskUsageTranscript, resolvePrivateTaskReference } from '../src/task-usage-transcript.mjs';
import { collectCompleteTaskUsage } from '../src/task-usage.mjs';

/** Load explicitly admitted private task captures; no discovery, inference, writes or credentials. */
export async function loadPrivateTaskMeasurement(manifestPath) {
  const absolute = resolve(manifestPath); const directory = dirname(absolute);
  const path = await resolvePrivateTaskReference(directory, basename(absolute));
  const snapshot = await readPrivateTaskSnapshot(path);
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(snapshot.data));
  if (!Array.isArray(manifest.captures) || manifest.captures.length > 128 ||
      !Array.isArray(manifest.decisions) || manifest.decisions.length > 128) throw new Error('Task usage manifest rejected.');
  let totalBytes = 0; const capturePaths = [];
  for (const descriptor of manifest.captures) {
    const capturePath = await resolvePrivateTaskReference(directory, descriptor.path);
    const stat = await fs.lstat(capturePath); totalBytes += stat.size;
    if (stat.size > 64_000_000 || totalBytes > 512_000_000) throw new Error('Task usage transcript budget exceeded.');
    capturePaths.push(capturePath);
  }
  const captures = [];
  for (let index = 0; index < capturePaths.length; index++) {
    const descriptor = manifest.captures[index];
    captures.push(await readTaskUsageTranscript(capturePaths[index], { client_version: manifest.client_version,
      thread_id: descriptor.thread_id, root_session_id: manifest.root_session_id, root_turn_id: manifest.root_turn_id }));
  }
  const decisions = [];
  for (const descriptor of manifest.decisions) {
    const decisionPath = await resolvePrivateTaskReference(directory, descriptor.path);
    const source = await readPrivateTaskSnapshot(decisionPath);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(source.data);
    decisions.push({ source_sha256: source.source_sha256, records: text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)) });
  }
  const result = collectCompleteTaskUsage(manifest, captures, decisions);
  result.source_hashes = [...new Set([snapshot.source_sha256, ...result.source_hashes])].sort();
  return result;
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
