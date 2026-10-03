import { collectCodexUsage, collectJevUsage } from './pilot-evaluation.mjs';
import { createHash } from 'node:crypto';
import { taskRootTurnIds } from './task-usage-transcript.mjs';

const fields = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
const usageValid = value => collectCodexUsage([{ session_id: 'validation', thread_id: 'validation', counter_epoch: '0', usage: value }], '0.159.2').available;
const sameUsage = (a, b) => fields.every(key => a?.[key] === b?.[key]);
const hashValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identityValid = value => typeof value === 'string' && value.length > 0 && value.length <= 256;

/** Account for complete task intervals separately from known lower bounds; the calibrated adapter has no exhaustive closure proof. */
export function collectCompleteTaskUsage(manifest, captures, decisions) {
  const unknownCodex = collectCodexUsage([], '0.159.2'), unknownJev = collectJevUsage([]);
  const result = { measurement_scope: 'task', task_coverage_verified: false, codex_usage: unknownCodex,
    jev_usage: unknownJev, providers: { codex: unknownCodex, jev: unknownJev },
    observed_providers: { codex: unknownCodex, jev: unknownJev },
    known_lower_bound: { codex_total_tokens: null, jev_total_tokens: null }, cost: null,
    limitations: ['Native exhaustive worker closure unavailable.', 'Native exhaustive provider closure unavailable.'], source_hashes: [] };
  try {
    const rootTurns = taskRootTurnIds(manifest); const admittedRootTurns = new Set(rootTurns);
    if (manifest?.manifest_version !== 1 || manifest.client_version !== '0.159.2' ||
        !['task_id', 'run_id', 'main_model', 'reasoning_effort', 'root_session_id'].every(key => identityValid(manifest[key])) ||
        !['captures', 'intervals', 'decisions'].every(key => Array.isArray(manifest[key])) ||
        !Array.isArray(captures) || !Array.isArray(decisions) ||
        !Array.isArray(manifest.closure?.worker_source_refs) || !Array.isArray(manifest.closure?.provider_source_refs)) throw new Error();
    const captureMap = new Map();
    for (const capture of captures) {
      if (!capture?.available || !hashValid(capture.source_sha256) || !identityValid(capture.thread_id)) continue;
      const prior = captureMap.get(capture.thread_id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(capture)) throw new Error();
      captureMap.set(capture.thread_id, capture);
    }
    const admitted = new Map();
    for (const descriptor of manifest.captures) {
      const capture = captureMap.get(descriptor?.thread_id);
      if (!hashValid(descriptor?.sha256) || !capture || descriptor.sha256 !== capture.source_sha256 ||
          capture.root_session_id !== manifest.root_session_id ||
          !taskRootTurnIds(capture).some(turn => admittedRootTurns.has(turn)) ||
          capture.client_version !== manifest.client_version || capture.main_model !== manifest.main_model ||
          capture.reasoning_effort !== manifest.reasoning_effort) { result.limitations.push('Task capture identity or source unavailable.'); continue; }
      admitted.set(capture.thread_id, capture); result.source_hashes.push(capture.source_sha256);
    }
    // Source hash -> admitted thread/turn -> nonoverlapping response interval -> observed lower bound.
    // Native closure stays unknown; independently bound provider decisions are accounted separately.
    const indexes = new Map();
    for (const capture of admitted.values()) indexes.set(capture.thread_id, {
      positions: new Map(capture.all_responses?.map((row, index) => [row.response_id, index])),
      selected: new Set(capture.responses?.map(row => row.response_id)), lastEnd: -1,
    });
    const orderedIntervals = [...manifest.intervals].sort((a, b) => {
      const thread = String(a?.thread_id).localeCompare(String(b?.thread_id));
      const start = row => row?.start_response_id === null ? -1 : indexes.get(row?.thread_id)?.positions.get(row?.start_response_id) ?? -2;
      return thread || start(a) - start(b);
    });
    const used = new Set(), intervalKeys = new Set(), events = [], allowedTurns = new Set();
    for (const interval of orderedIntervals) {
      try {
        const key = JSON.stringify(interval); if (intervalKeys.has(key)) continue;
        const capture = admitted.get(interval?.thread_id);
        if (!capture || !Array.isArray(interval.response_ids) || !interval.response_ids.length ||
            new Set(interval.response_ids).size !== interval.response_ids.length ||
            !usageValid(interval.initial_usage) || !usageValid(interval.final_usage) ||
            !Array.isArray(capture.all_responses) || !Array.isArray(capture.responses)) throw new Error();
        if (capture.thread_id !== manifest.root_session_id && !admitted.has(capture.parent_thread_id)) throw new Error();
        const records = capture.all_responses;
        const index = indexes.get(capture.thread_id);
        const start = interval.start_response_id === null ? -1 : index.positions.get(interval.start_response_id) ?? -2;
        const end = index.positions.get(interval.end_response_id) ?? -2;
        if (start < -1 || end <= start || start < index.lastEnd) throw new Error();
        const selected = records.slice(start + 1, end + 1);
        if (manifest.root_turn_ids !== undefined && !identityValid(interval.turn_id)) throw new Error();
        if (JSON.stringify(selected.map(row => row.response_id)) !== JSON.stringify(interval.response_ids) ||
            selected.some(row => !admittedRootTurns.has(row.root_turn_id) ||
              interval.turn_id !== undefined && row.turn_id !== interval.turn_id ||
              !index.selected.has(row.response_id) || !usageValid(row.usage) ||
              used.has(JSON.stringify([capture.thread_id, row.response_id]))) ||
            !sameUsage(records[end].thread_usage, interval.final_usage)) throw new Error();
        if (start === -1) {
          if (fields.some(field => interval.initial_usage[field] !== 0) || !capture.task_records?.some(row =>
            row.type === 'task_started' && row.turn_id === selected[0].turn_id)) throw new Error();
        } else if (!sameUsage(records[start].thread_usage, interval.initial_usage)) throw new Error();
        const delta = Object.fromEntries(fields.map(field => [field, interval.final_usage[field] - interval.initial_usage[field]]));
        const summed = Object.fromEntries(fields.map(field => [field, selected.reduce((total, row) => total + row.usage[field], 0)]));
        if (!usageValid(delta) || !sameUsage(summed, delta)) throw new Error();
        for (const row of selected) { used.add(JSON.stringify([capture.thread_id, row.response_id])); allowedTurns.add(row.turn_id); }
        events.push({ session_id: manifest.root_session_id, thread_id: capture.thread_id, counter_epoch: key, usage: delta });
        intervalKeys.add(key); index.lastEnd = end;
      } catch { result.limitations.push('Task interval boundary or arithmetic unavailable.'); }
    }
    const codex = collectCodexUsage(events, manifest.client_version);
    result.observed_providers.codex = codex;
    result.known_lower_bound.codex_total_tokens = codex.total_tokens;
    const providerRecords = []; let providerRejected = false;
    const identityHash = id => createHash('sha256').update(id).digest('hex');
    const turnHashes = new Set([...allowedTurns].map(identityHash));
    const decisionIdentityAdmitted = row => {
      if (!row) return false;
      const raw = row.session_id !== undefined || row.turn_id !== undefined;
      const hashed = row.session_hash !== undefined || row.turn_hash !== undefined;
      return (raw || hashed) && (!raw || row.session_id === manifest.root_session_id && allowedTurns.has(row.turn_id)) &&
        (!hashed || row.session_hash === identityHash(manifest.root_session_id) && turnHashes.has(row.turn_hash)) &&
        (!(raw && hashed) || row.turn_hash === identityHash(row.turn_id));
    };
    const decisionSources = new Map(decisions.map(source => [source?.path, source]));
    for (const descriptor of manifest.decisions) {
      const source = decisionSources.get(descriptor?.path);
      if (!hashValid(descriptor?.sha256) || !source || source.source_sha256 !== descriptor.sha256 || !Array.isArray(source.records) ||
          source.records.some(row => !decisionIdentityAdmitted(row))) {
        providerRejected = true; continue;
      }
      result.source_hashes.push(source.source_sha256); providerRecords.push(...source.records);
    }
    const jev = providerRejected ? unknownJev : collectJevUsage(providerRecords);
    result.observed_providers.jev = jev;
    // Incomplete billing does not erase other independently verified decisions; conflicting identities contribute nothing.
    const decisionGroups = new Map();
    for (const record of providerRecords) {
      const group = decisionGroups.get(record.decision_id) ?? []; group.push(record); decisionGroups.set(record.decision_id, group);
    }
    const knownBilling = [...decisionGroups.values()].map(group => collectJevUsage(group)).filter(usage => usage.available);
    const knownTokens = knownBilling.reduce((total, usage) => total + usage.total_tokens, 0);
    result.known_lower_bound.jev_total_tokens = knownBilling.length && Number.isSafeInteger(knownTokens) ? knownTokens : null;
    if (!jev.available) result.limitations.push('Observed Jev billing unavailable.');
    // Native terminal records are not exhaustive worker or provider discovery; flags/references never authorize totals.
    result.source_hashes = [...new Set(result.source_hashes)].sort();
    result.limitations = [...new Set(result.limitations)];
    return result;
  } catch {
    result.limitations.push('Task measurement manifest rejected.'); return result;
  }
}
