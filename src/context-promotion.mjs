import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const corpusText = readFileSync(new URL('../evaluation/tasks.jsonl', import.meta.url), 'utf8');
const corpusHash = createHash('sha256').update(corpusText).digest('hex');
const heldOutTasks = new Map(corpusText.trim().split('\n').map(row => JSON.parse(row))
  .filter(task => task.split === 'held_out').map(task => [task.task_id, task]));
const contextFamilies = ['code_context', 'code_review_context', 'documentation_context'];
const variants = ['baseline', 'deterministic', 'hybrid'];
const hash = value => createHash('sha256').update(value).digest('hex');
const median = values => {
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const percentile95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];

function pilotVersionFingerprint(versions, variant) {
  const fields = ['client_version', 'policy_hash', 'main_model', 'reasoning_effort'];
  if (variant === 'hybrid') fields.push('questions_hash', 'jev_model');
  if (!versions || !fields.every(key => typeof versions[key] === 'string' && versions[key] && versions[key] !== 'unverified') ||
      !/^\d+\.\d+\.\d+$/.test(versions.client_version) || !/^[a-f0-9]{64}$/.test(versions.policy_hash) ||
      (variant === 'hybrid' && !/^[a-f0-9]{64}$/.test(versions.questions_hash))) return null;
  return hash(JSON.stringify(fields.map(key => [key, versions[key]])));
}

function pilotRunTokens(run) {
  const codex = run.codex_usage; const jev = run.jev_usage;
  if (run.native_execution_verified !== true || run.task_coverage_verified !== true || codex?.available !== true || jev?.available !== true ||
      !['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens']
        .every(key => Number.isSafeInteger(codex[key]) && codex[key] >= 0) ||
      codex.total_tokens !== codex.input_tokens + codex.output_tokens || codex.cached_input_tokens > codex.input_tokens ||
      codex.cache_write_input_tokens > codex.input_tokens || codex.reasoning_output_tokens > codex.output_tokens ||
      !['input_tokens', 'output_tokens', 'total_tokens', 'requests'].every(key => Number.isSafeInteger(jev[key]) && jev[key] >= 0) ||
      jev.total_tokens !== jev.input_tokens + jev.output_tokens ||
      !Array.isArray(jev.models) || (jev.requests === 0 && (jev.total_tokens !== 0 || jev.models.length !== 0)) ||
      (run.variant !== 'hybrid' && (jev.requests !== 0 || jev.models.length !== 0)) ||
      (jev.requests > 0 && (!jev.models.length || jev.models.some(model => model !== run.versions?.jev_model)))) return null;
  const total = codex.total_tokens + jev.total_tokens;
  return Number.isSafeInteger(total) ? total : null;
}

function pilotRunQuality(run) {
  const quality = run.quality;
  return quality?.correct === true && quality.critical_regression === false &&
    quality.evidence_complete === true && quality.checks_complete === true;
}

/** Compare pilot runs using the frozen held-out corpus and all providers' complete-task tokens; failures remain reported.
 * @param {Array<object>} runs
 * @returns {{report_version:number,corpus_hash:string,runs:object[],families:object[],promotions:object[],limitations:string[]}} */
export function comparePilotRuns(runs) {
  const report = { report_version: 1, corpus_hash: corpusHash, runs: Array.isArray(runs) ? runs : [],
    families: [], promotions: [], limitations: [] };
  if (!Array.isArray(runs) || !runs.length) { report.limitations.push('Complete paired native runs are missing.'); return report; }
  const pairs = new Map(); const runIds = new Set();
  for (const run of runs) {
    const task = heldOutTasks.get(run?.task_id);
    if (!task || run.split !== 'held_out' || !variants.includes(run.variant) || !contextFamilies.includes(run.family) ||
        typeof run.run_id !== 'string' || !run.run_id || runIds.has(run.run_id) || run.corpus_hash !== corpusHash ||
        run.prompt_hash !== hash(task.prompt) || run.initial_revision !== task.initial_revision || run.fixture_hash !== task.fixture.sha256 ||
        !Number.isFinite(run.duration_ms) || run.duration_ms < 0 || ![0, 1, 2].includes(run.order_index) || run.cache_control !== 'recorded') {
      report.limitations.push('Pilot identity, corpus, prompt, state, ordering or cache controls are invalid.'); return report;
    }
    runIds.add(run.run_id); const pair = pairs.get(run.task_id) ?? {};
    if (pair[run.variant]) { report.limitations.push('Duplicate task variants require a separately identified repeated experiment.'); return report; }
    pair[run.variant] = run; pairs.set(run.task_id, pair);
  }
  if (pairs.size !== heldOutTasks.size || [...pairs.values()].some(pair => variants.some(variant => !pair[variant]))) {
    report.limitations.push('All 60 held-out tasks require baseline, deterministic and hybrid native executions.'); return report;
  }
  for (const family of contextFamilies) {
    const familyPairs = [...pairs.values()].filter(pair => pair.baseline.family === family);
    if (!familyPairs.length) continue;
    for (const variant of ['deterministic', 'hybrid']) {
      const limitations = []; const reductions = []; const durations = []; const increments = []; const failedTaskIds = [];
      const fingerprints = new Set();
      for (const pair of familyPairs) {
        const baseline = pair.baseline; const candidate = pair[variant]; const deterministic = pair.deterministic;
        const baseVersion = pilotVersionFingerprint(baseline.versions, 'deterministic');
        const version = pilotVersionFingerprint(candidate.versions, variant);
        if (candidate.family !== family || !baseVersion || !version ||
            baseVersion !== pilotVersionFingerprint(candidate.versions, 'deterministic') ||
            new Set(variants.map(key => pair[key].order_index)).size !== 3) limitations.push('Mismatched main model/effort, versions, family or paired order.');
        if (version) fingerprints.add(version);
        const baseTokens = pilotRunTokens(baseline); const candidateTokens = pilotRunTokens(candidate);
        if (baseTokens === null || candidateTokens === null || baseTokens === 0) limitations.push('Complete task/worker/provider usage is unknown or invalid.');
        if (!pilotRunQuality(baseline) || !pilotRunQuality(candidate)) {
          failedTaskIds.push(candidate.task_id); limitations.push('Answer quality, required evidence or check completion is not verified.');
        }
        if (baseTokens !== null && candidateTokens !== null && baseTokens > 0 && pilotRunQuality(baseline) && pilotRunQuality(candidate))
          reductions.push((baseTokens - candidateTokens) / baseTokens);
        durations.push(candidate.duration_ms - baseline.duration_ms);
        if (variant === 'hybrid') {
          const deterministicTokens = pilotRunTokens(deterministic);
          if (deterministic.family !== family || deterministicTokens === null || !pilotRunQuality(deterministic) || !baseVersion ||
              baseVersion !== pilotVersionFingerprint(deterministic.versions, 'deterministic')) limitations.push('Deterministic comparison is not verified.');
          else if (candidateTokens !== null) increments.push(deterministicTokens - candidateTokens);
          if (candidate.duration_ms > deterministic.duration_ms) limitations.push('Hybrid increases latency over deterministic.');
        }
      }
      if (fingerprints.size !== 1) limitations.push('The experiment mixes version fingerprints.');
      if (familyPairs.length < 10) limitations.push('Fewer than ten paired tasks provide insufficient family evidence.');
      const reduction = reductions.length ? median(reductions) : null;
      if (reduction === null || reduction + Number.EPSILON < 0.20) limitations.push('Median paired total-token reduction is below 20%.');
      if (median(durations) > 0 || percentile95(durations) > 1000) limitations.push('Median or p95 task latency exceeds the allowed bounds.');
      if (variant === 'hybrid' && (!increments.length || median(increments) <= 0)) limitations.push('Hybrid has no demonstrated incremental total-token value.');
      const summary = { family, variant, sample_size: familyPairs.length, correct_pairs: reductions.length,
        median_token_reduction: reduction, median_latency_delta_ms: median(durations), p95_latency_delta_ms: percentile95(durations),
        failed_task_ids: failedTaskIds, limitations: [...new Set(limitations)], fingerprint: fingerprints.size === 1 ? [...fingerprints][0] : null };
      report.families.push(summary);
      if (!summary.limitations.length) report.promotions.push({ family, variant, fingerprint: summary.fingerprint });
    }
  }
  return report;
}

/** Resolve context promotion from recomputed complete version-matched evidence; mode and disabled Jev remain authoritative.
 * @param {{mode:string,jev_enabled:boolean,operations?:Record<string,string>}} config
 * @param {string} family
 * @param {object} versions
 * @param {object|null} report
 * @returns {'off'|'shadow'|'deterministic'|'hybrid'} */
export function resolveContextPromotion(config, family, versions, report) {
  const familyMode = config.operations?.[family] ?? 'shadow';
  if (config.mode === 'off' || familyMode === 'off') return 'off';
  if (config.mode !== 'enforce' || familyMode !== 'enforce' || !contextFamilies.includes(family) ||
      report?.report_version !== 1 || report.corpus_hash !== corpusHash) return 'shadow';
  const measured = comparePilotRuns(report.runs);
  for (const variant of config.jev_enabled ? ['hybrid', 'deterministic'] : ['deterministic']) {
    const fingerprint = pilotVersionFingerprint(versions, variant);
    if (fingerprint && measured.promotions.some(promotion => promotion.family === family && promotion.variant === variant &&
        promotion.fingerprint === fingerprint)) return variant;
  }
  return 'shadow';
}
