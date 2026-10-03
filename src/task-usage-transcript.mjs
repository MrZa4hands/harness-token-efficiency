import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative, join, isAbsolute } from 'node:path';
import { collectCodexUsage } from './pilot-evaluation.mjs';

const fields = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
const zeroUsage = () => Object.fromEntries(fields.map(key => [key, 0]));
const validIdentity = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const validUsage = usage => collectCodexUsage([{ session_id: 'validation', thread_id: 'validation', counter_epoch: '0', usage }], '0.159.2').available;

/** Resolve private task references inside the canonical manifest directory; reject every linked or nonprivate component. */
export async function resolvePrivateTaskReference(directory, reference) {
  if (typeof reference !== 'string' || !reference || isAbsolute(reference)) throw new Error('Task usage reference rejected.');
  const root = resolve(directory); const target = resolve(root, reference); const local = relative(root, target);
  if (!local || local === '..' || local.startsWith('../') || await fs.realpath(root) !== root) throw new Error('Task usage reference rejected.');
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.uid !== process.getuid() || (rootStat.mode & 0o077) !== 0) throw new Error('Task usage reference rejected.');
  let current = root; const parts = local.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]); const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0 ||
        (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw new Error('Task usage reference rejected.');
  }
  return target;
}

/** Read a private task file from one bounded immutable snapshot; bytes never enter error messages. */
export async function readPrivateTaskSnapshot(path, byteLimit = 4_000_000) {
  let file;
  try {
    file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.uid !== BigInt(process.getuid()) || (before.mode & 0o077n) !== 0n ||
        before.size === 0n || before.size > BigInt(byteLimit)) throw new Error();
    const size = Number(before.size); const data = Buffer.alloc(size); let offset = 0;
    while (offset < size) {
      const { bytesRead } = await file.read(data, offset, Math.min(65536, size - offset), offset);
      if (!bytesRead) throw new Error(); offset += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key])) throw new Error();
    return { data, snapshot_bytes: size, source_sha256: createHash('sha256').update(data).digest('hex') };
  } catch { throw new Error('Task usage private snapshot rejected.'); }
  finally { await file?.close(); }
}

/** Read task-scoped native usage, excluding inherited responses; exhaustive worker/provider closure is unobservable. */
export async function readTaskUsageTranscript(path, options) {
  const unavailable = { available: false, initial_usage: null, final_usage: null, responses: [],
    worker_coverage_verified: false, provider_coverage_verified: false, limitations: ['Task usage transcript unavailable.'] };
  try {
    if (!options || options.client_version !== '0.159.2' ||
        !['thread_id', 'root_session_id', 'root_turn_id'].every(key => validIdentity(options[key]))) return unavailable;
    const snapshot = await readPrivateTaskSnapshot(path, 64_000_000);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(snapshot.data);
    if (!text.endsWith('\n')) return unavailable;
    const rows = text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    const metadata = rows.filter(row => row.type === 'session_meta' && row.payload?.id === options.thread_id).map(row => row.payload);
    if (!metadata.length || metadata.some(meta => meta.session_id !== options.root_session_id ||
        meta.cli_version !== options.client_version || meta.parent_thread_id !== metadata[0].parent_thread_id)) return unavailable;
    const contexts = new Map();
    for (const row of rows) if (row.type === 'turn_context' && validIdentity(row.payload?.turn_id)) {
      const context = row.payload;
      const prior = contexts.get(context.turn_id);
      if (prior && (prior.model !== context.model || prior.effort !== context.effort || prior.root_turn_id !== context.root_turn_id)) return unavailable;
      contexts.set(context.turn_id, { model: context.model, effort: context.effort, root_turn_id: context.root_turn_id });
    }
    const seen = new Map(); const allResponses = []; let previous = null;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]; const p = row.payload;
      if (row.type !== 'token_usage_record' || p?.thread_id !== options.thread_id) continue;
      if (p.session_id !== options.root_session_id || !validIdentity(p.response_id) || !validIdentity(p.turn_id) ||
          !validIdentity(p.root_turn_id) || !validUsage(p.usage) || !validUsage(p.thread_token_usage)) return unavailable;
      const record = { response_id: p.response_id, turn_id: p.turn_id, root_turn_id: p.root_turn_id,
        usage: Object.fromEntries(fields.map(key => [key, p.usage[key]])),
        thread_usage: Object.fromEntries(fields.map(key => [key, p.thread_token_usage[key]])), record_index: index };
      const old = seen.get(p.response_id);
      if (old) {
        if (JSON.stringify({ ...old, record_index: 0 }) !== JSON.stringify({ ...record, record_index: 0 })) return unavailable;
        continue;
      }
      if (previous && fields.some(key => p.thread_token_usage[key] !== previous[key] + p.usage[key])) return unavailable;
      if (fields.some(key => p.thread_token_usage[key] < p.usage[key])) return unavailable;
      seen.set(p.response_id, record); allResponses.push(record); previous = record.thread_usage;
    }
    const responses = allResponses.filter(row => row.root_turn_id === options.root_turn_id);
    if (!responses.length) return unavailable;
    const settings = responses.map(row => contexts.get(row.turn_id));
    if (settings.some(context => !context || context.root_turn_id !== options.root_turn_id ||
        !validIdentity(context.model) || !validIdentity(context.effort) ||
        context.model !== settings[0].model || context.effort !== settings[0].effort)) return unavailable;
    const first = responses[0]; const initial = Object.fromEntries(fields.map(key => [key, first.thread_usage[key] - first.usage[key]]));
    if (!validUsage(initial)) return unavailable;
    const turnIds = new Set(responses.map(row => row.turn_id));
    const taskRecords = rows.flatMap((row, index) => row.type === 'event_msg' &&
      ['task_started', 'task_complete'].includes(row.payload?.type) && turnIds.has(row.payload.turn_id) ?
      [{ record_index: index, type: row.payload.type, turn_id: row.payload.turn_id,
        root_turn_id: row.payload.root_turn_id ?? options.root_turn_id, completed_at: row.payload.completed_at ?? null }] : []);
    return { available: true, ...options, source_sha256: snapshot.source_sha256, snapshot_bytes: snapshot.snapshot_bytes,
      main_model: settings[0].model, reasoning_effort: settings[0].effort,
      parent_thread_id: metadata[0].parent_thread_id ?? null, agent_path: metadata[0].agent_path ?? null,
      initial_usage: initial, final_usage: responses.at(-1).thread_usage, responses, all_responses: allResponses,
      task_records: taskRecords, worker_coverage_verified: false, provider_coverage_verified: false,
      limitations: ['Native exhaustive worker closure unavailable.', 'Native exhaustive provider closure unavailable.'] };
  } catch { return unavailable; }
}
