import { collectCodexUsage, collectJevUsage } from './pilot-evaluation.mjs';

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
    if (manifest?.manifest_version !== 1 || manifest.client_version !== '0.159.2' ||
        !['task_id', 'run_id', 'main_model', 'reasoning_effort', 'root_session_id', 'root_turn_id'].every(key => identityValid(manifest[key])) ||
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
          capture.root_session_id !== manifest.root_session_id || capture.root_turn_id !== manifest.root_turn_id ||
          capture.client_version !== manifest.client_version || capture.main_model !== manifest.main_model ||
          capture.reasoning_effort !== manifest.reasoning_effort) { result.limitations.push('Task capture identity or source unavailable.'); continue; }
      admitted.set(capture.thread_id, capture); result.source_hashes.push(capture.source_sha256);
    }
    const used = new Set(), intervalKeys = new Set(), events = [], allowedTurns = new Set();
    for (const interval of manifest.intervals) {
      try {
        const key = JSON.stringify(interval); if (intervalKeys.has(key)) continue;
        const capture = admitted.get(interval?.thread_id);
        if (!capture || !Array.isArray(interval.response_ids) || !interval.response_ids.length ||
            new Set(interval.response_ids).size !== interval.response_ids.length ||
            !usageValid(interval.initial_usage) || !usageValid(interval.final_usage) ||
            !Array.isArray(capture.all_responses) || !Array.isArray(capture.responses)) throw new Error();
        if (capture.thread_id !== manifest.root_session_id && !admitted.has(capture.parent_thread_id)) throw new Error();
        const records = capture.all_responses;
        const start = interval.start_response_id === null ? -1 : records.findIndex(row => row.response_id === interval.start_response_id);
        const end = records.findIndex(row => row.response_id === interval.end_response_id);
        if (start < -1 || interval.start_response_id !== null && start === -1 || end <= start) throw new Error();
        const selected = records.slice(start + 1, end + 1);
        if (JSON.stringify(selected.map(row => row.response_id)) !== JSON.stringify(interval.response_ids) ||
            selected.some(row => row.root_turn_id !== manifest.root_turn_id ||
              !capture.responses.some(response => response.response_id === row.response_id) || !usageValid(row.usage) ||
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
        intervalKeys.add(key);
      } catch { result.limitations.push('Task interval boundary or arithmetic unavailable.'); }
    }
    const codex = collectCodexUsage(events, manifest.client_version);
    result.observed_providers.codex = codex;
    result.known_lower_bound.codex_total_tokens = codex.total_tokens;
    const providerRecords = []; let providerRejected = false;
    for (const descriptor of manifest.decisions) {
      const source = decisions.find(value => value?.source_sha256 === descriptor?.sha256);
      if (!hashValid(descriptor?.sha256) || !source || !Array.isArray(source.records) ||
          source.records.some(row => row?.session_id !== manifest.root_session_id || !allowedTurns.has(row.turn_id))) {
        providerRejected = true; continue;
      }
      result.source_hashes.push(source.source_sha256); providerRecords.push(...source.records);
    }
    const jev = providerRejected ? unknownJev : collectJevUsage(providerRecords);
    result.observed_providers.jev = jev;
    result.known_lower_bound.jev_total_tokens = jev.total_tokens;
    if (!jev.available) result.limitations.push('Observed Jev billing unavailable.');
    // Native terminal records are not exhaustive worker or provider discovery; flags/references never authorize totals.
    result.source_hashes = [...new Set(result.source_hashes)].sort();
    result.limitations = [...new Set(result.limitations)];
    return result;
  } catch {
    result.limitations.push('Task measurement manifest rejected.'); return result;
  }
}
