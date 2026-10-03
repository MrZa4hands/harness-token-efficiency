import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative, join, isAbsolute, dirname } from 'node:path';
import { collectCodexUsage } from './pilot-evaluation.mjs';

const fields = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
const validIdentity = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const validUsage = usage => collectCodexUsage([{ session_id: 'validation', thread_id: 'validation', counter_epoch: '0', usage }], '0.159.2').available;

/** Admit ordered unique root task turns; singular identities retain the shipped one-turn contract. */
export function taskRootTurnIds(value) {
  const turns = value?.root_turn_ids ?? (validIdentity(value?.root_turn_id) ? [value.root_turn_id] : []);
  if (!Array.isArray(turns) || !turns.length || !turns.every(validIdentity) || new Set(turns).size !== turns.length ||
      value.root_turn_ids !== undefined && value.root_turn_id !== undefined &&
      (turns.length !== 1 || turns[0] !== value.root_turn_id)) throw new Error('Task turn membership rejected.');
  return turns;
}

/** Resolve private task references inside the canonical manifest directory; reject every linked or nonprivate component. */
export async function resolvePrivateTaskReference(directory, reference) {
  try {
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
  } catch (error) {
    const rejected = new Error('Task usage reference rejected.');
    if (error.code === 'ENOENT') rejected.code = 'ENOENT';
    throw rejected;
  }
}

// Revalidate ancestor identities around descriptor opening and reads; same-user swap-and-restore is not sandboxed.
async function taskSnapshotAncestors(path) {
  const result = []; let directory = dirname(resolve(path));
  while (true) {
    const stat = await fs.lstat(directory, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
    result.push([directory, String(stat.dev), String(stat.ino)]);
    const parent = dirname(directory); if (parent === directory) return JSON.stringify(result); directory = parent;
  }
}

/** Read a bounded task file snapshot; public corpus files still require stable regular descriptors and ancestors. */
export async function readTaskFileSnapshot(path, byteLimit, requirePrivate = true, allowEmpty = false) {
  let file;
  try {
    const ancestors = await taskSnapshotAncestors(path);
    file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await file.stat({ bigint: true });
    if (await taskSnapshotAncestors(path) !== ancestors || !before.isFile() ||
        requirePrivate && (before.uid !== BigInt(process.getuid()) || (before.mode & 0o077n) !== 0n) ||
        !allowEmpty && before.size === 0n || before.size > BigInt(byteLimit)) throw new Error();
    const size = Number(before.size); const data = Buffer.alloc(size); let offset = 0;
    while (offset < size) {
      const { bytesRead } = await file.read(data, offset, Math.min(65536, size - offset), offset);
      if (!bytesRead) throw new Error(); offset += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (await taskSnapshotAncestors(path) !== ancestors ||
        ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key])) throw new Error();
    return { data, snapshot_bytes: size, source_sha256: createHash('sha256').update(data).digest('hex') };
  } catch { throw new Error('Task usage private snapshot rejected.'); }
  finally { await file?.close(); }
}

/** Read a private task snapshot; optional safe empty evidence carries no inferred counters or attempts. */
export async function readPrivateTaskSnapshot(path, byteLimit = 4_000_000, allowEmpty = false) {
  return readTaskFileSnapshot(path, byteLimit, true, allowEmpty);
}

/** Share parsed-record and retained-identity budgets across one offline invocation. */
export const createTaskReadBudget = () => ({ records: 0, identities: new Set() });

/** Retain a namespaced response/decision identity once within the invocation's fixed cap. */
export function retainTaskReadIdentity(budget, namespace, identity) {
  if (!validIdentity(identity)) throw new Error('Task usage identity rejected.');
  const key = JSON.stringify([namespace, identity]);
  if (!budget.identities.has(key)) {
    if (budget.identities.size >= 100_000) {
      const error = new Error('Task usage identity budget exceeded.'); error.budget_exceeded = true; throw error;
    }
    budget.identities.add(key);
  }
}

/** Stream/hash/parse a stable descriptor; callbacks receive exact original row hashes, never reopened paths. */
export async function readTaskJsonlSnapshot(path, options, onRecord) {
  let file, size;
  try {
    const budget = options.budget ?? createTaskReadBudget();
    const byteLimit = options.byte_limit ?? 4_000_000;
    if (!Number.isSafeInteger(byteLimit) || byteLimit < 1 || byteLimit > 64_000_000) throw new Error();
    const ancestors = await taskSnapshotAncestors(path);
    file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await file.stat({ bigint: true });
    if (await taskSnapshotAncestors(path) !== ancestors || !before.isFile() ||
        options.require_private !== false && (before.uid !== BigInt(process.getuid()) || (before.mode & 0o077n) !== 0n) ||
        !options.allow_empty && before.size === 0n || before.size > BigInt(byteLimit)) throw new Error();
    size = Number(before.size);
    const hash = createHash('sha256'); const chunk = Buffer.alloc(65_536);
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    let offset = 0, pending = Buffer.alloc(0), records = 0;
    const consume = bytes => {
      if (bytes.length > 1_000_000) {
        const error = new Error(); error.budget_exceeded = true; throw error;
      }
      const text = decoder.decode(bytes);
      if (!text.trim()) return;
      if (records >= 100_000 || budget.records >= 250_000) {
        const error = new Error(); error.budget_exceeded = true; throw error;
      }
      const index = records++; budget.records++;
      onRecord(JSON.parse(text), createHash('sha256').update(bytes).digest('hex'), index);
    };
    while (offset < size) {
      const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, size - offset), offset);
      if (!bytesRead) throw new Error(); offset += bytesRead;
      const bytes = chunk.subarray(0, bytesRead); hash.update(bytes);
      let start = 0;
      for (let end = bytes.indexOf(10); end !== -1; end = bytes.indexOf(10, start)) {
        const segment = bytes.subarray(start, end + 1);
        consume(pending.length ? Buffer.concat([pending, segment]) : segment);
        pending = Buffer.alloc(0); start = end + 1;
      }
      if (start < bytes.length) {
        if (pending.length + bytes.length - start > 1_000_000) {
          const error = new Error(); error.budget_exceeded = true; throw error;
        }
        pending = Buffer.concat([pending, bytes.subarray(start)]);
      }
    }
    if (pending.length) { if (options.require_terminated) throw new Error(); consume(pending); }
    const after = await file.stat({ bigint: true });
    if (await taskSnapshotAncestors(path) !== ancestors ||
        ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key])) throw new Error();
    return { snapshot_bytes: size, source_sha256: hash.digest('hex'), record_count: records };
  } catch (cause) {
    const error = new Error('Task usage JSONL snapshot or budget rejected.');
    error.snapshot_bytes = size; error.budget_exceeded = cause.budget_exceeded === true; throw error;
  } finally { await file?.close(); }
}

/** Read task-scoped native usage, excluding inherited responses; exhaustive worker/provider closure is unobservable. */
export async function readTaskUsageTranscript(path, options) {
  const unavailable = { available: false, initial_usage: null, final_usage: null, responses: [],
    worker_coverage_verified: false, provider_coverage_verified: false, limitations: ['Task usage transcript unavailable.'] };
  try {
    if (!options || options.client_version !== '0.159.2' ||
        !['thread_id', 'root_session_id'].every(key => validIdentity(options[key]))) return unavailable;
    const rootTurns = taskRootTurnIds(options); const admittedTurns = new Set(rootTurns);
    const budget = options.read_budget ?? createTaskReadBudget();
    const contexts = new Map(), seen = new Map(), allResponses = [], taskEvents = [];
    let metadata = null, previous = null;
    const snapshot = await readTaskJsonlSnapshot(path, { budget, byte_limit: Math.min(64_000_000, options.byte_limit ?? 64_000_000),
      allow_empty: true, require_terminated: true }, (row, hash, index) => {
      const p = row?.payload;
      if (row?.type === 'session_meta' && p?.id === options.thread_id) {
        if (p.session_id !== options.root_session_id || p.cli_version !== options.client_version ||
            metadata && p.parent_thread_id !== metadata.parent_thread_id) throw new Error();
        metadata = { parent_thread_id: p.parent_thread_id, agent_path: p.agent_path };
      }
      if (row?.type === 'turn_context' && validIdentity(p?.turn_id)) {
        const context = { model: p.model, effort: p.effort, root_turn_id: p.root_turn_id };
        const prior = contexts.get(p.turn_id);
        if (prior && JSON.stringify(prior) !== JSON.stringify(context)) throw new Error();
        contexts.set(p.turn_id, context);
      }
      if (row?.type === 'event_msg' && ['task_started', 'task_complete'].includes(p?.type)) {
        taskEvents.push({ record_index: index, type: p.type, turn_id: p.turn_id,
          root_turn_id: p.root_turn_id, completed_at: p.completed_at ?? null });
      }
      if (row?.type !== 'token_usage_record' || p?.thread_id !== options.thread_id) return;
      if (p.session_id !== options.root_session_id || !validIdentity(p.response_id) || !validIdentity(p.turn_id) ||
          !validIdentity(p.root_turn_id) || !validUsage(p.usage) || !validUsage(p.thread_token_usage)) throw new Error();
      const record = { response_id: p.response_id, turn_id: p.turn_id, root_turn_id: p.root_turn_id,
        usage: Object.fromEntries(fields.map(key => [key, p.usage[key]])),
        thread_usage: Object.fromEntries(fields.map(key => [key, p.thread_token_usage[key]])), record_index: index };
      const old = seen.get(p.response_id);
      if (old) {
        if (JSON.stringify({ ...old, record_index: 0 }) !== JSON.stringify({ ...record, record_index: 0 })) throw new Error();
        return;
      }
      if (previous && fields.some(key => p.thread_token_usage[key] !== previous[key] + p.usage[key])) throw new Error();
      if (fields.some(key => p.thread_token_usage[key] < p.usage[key])) throw new Error();
      retainTaskReadIdentity(budget, options.thread_id, p.response_id);
      seen.set(p.response_id, record); allResponses.push(record); previous = record.thread_usage;
    });
    unavailable.snapshot_bytes = snapshot.snapshot_bytes; unavailable.source_sha256 = snapshot.source_sha256;
    if (!metadata) return unavailable;
    const responses = allResponses.filter(row => admittedTurns.has(row.root_turn_id));
    if (!responses.length) return unavailable;
    const observedRootTurns = new Set(responses.map(row => row.root_turn_id));
    if (rootTurns.some(turn => !observedRootTurns.has(turn))) return unavailable;
    const settings = responses.map(row => contexts.get(row.turn_id));
    if (settings.some((context, index) => !context || context.root_turn_id !== responses[index].root_turn_id ||
        !validIdentity(context.model) || !validIdentity(context.effort) ||
        context.model !== settings[0].model || context.effort !== settings[0].effort)) return unavailable;
    const first = responses[0]; const initial = Object.fromEntries(fields.map(key => [key, first.thread_usage[key] - first.usage[key]]));
    if (!validUsage(initial)) return unavailable;
    const turnIds = new Set(responses.map(row => row.turn_id));
    const taskRecords = taskEvents.filter(row => turnIds.has(row.turn_id)).map(row => ({ ...row,
      root_turn_id: row.root_turn_id ?? contexts.get(row.turn_id)?.root_turn_id ?? null }));
    const { byte_limit, read_budget, ...identities } = options;
    return { available: true, ...identities, root_turn_ids: rootTurns, source_sha256: snapshot.source_sha256, snapshot_bytes: snapshot.snapshot_bytes,
      main_model: settings[0].model, reasoning_effort: settings[0].effort,
      parent_thread_id: metadata.parent_thread_id ?? null, agent_path: metadata.agent_path ?? null,
      initial_usage: initial, final_usage: responses.at(-1).thread_usage, responses, all_responses: allResponses,
      task_records: taskRecords, worker_coverage_verified: false, provider_coverage_verified: false,
      limitations: ['Native exhaustive worker closure unavailable.', 'Native exhaustive provider closure unavailable.'] };
  } catch (error) {
    if (error.snapshot_bytes !== undefined) unavailable.snapshot_bytes = error.snapshot_bytes;
    if (error.budget_exceeded) unavailable.budget_exceeded = true;
    return unavailable;
  }
}
