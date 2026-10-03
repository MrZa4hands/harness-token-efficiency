const causes = ['selection_or_delivery', 'answer_omission', 'corpus_scope_mismatch', 'unknown'];
const proofKinds = { selection_or_delivery: 'delivery_trace', answer_omission: 'delivered_evidence',
  corpus_scope_mismatch: 'scope_annotation', unknown: 'unverified' };
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validIdentity = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const emptyCounts = () => Object.fromEntries(causes.map(cause => [cause, 0]));

// Compare attested semantics; JSON object and evidence-set ordering carry no causal meaning.
const pilotAssessmentIdentity = annotation => JSON.stringify([annotation.run_id, annotation.task_id,
  annotation.run_row_sha256, annotation.primary_cause, [...annotation.requirement_ids].sort(),
  [...new Set(annotation.proof_sha256s)].sort(),
  [...new Set(annotation.proofs.map(proof => JSON.stringify([proof.sha256, proof.kind])))].sort()]);

/** Diagnose historical evidence omissions with owner-attested typed proof hashes; never regrade original runs. */
export function diagnosePilotEvidence(tasks, runSources, assessments) {
  if (![tasks, runSources, assessments].every(Array.isArray)) throw new Error('Pilot evidence diagnostics input rejected.');
  // Original row bytes -> authoritative source wrapper -> attested assessment -> private details / public aggregates.
  // Legacy pure callers retain supplied hashes; filesystem loaders always provide independent wrappers.
  const runs = runSources.map(source => source && Object.hasOwn(source, 'row') ?
    { ...source.row, run_row_sha256: source.run_row_sha256 } : source);
  const taskMap = new Map(tasks.map(task => [task.task_id, task]));
  const runMap = new Map(runs.map(run => [run.run_id, run]));
  if (taskMap.size !== tasks.length || runMap.size !== runs.length || runs.some(run =>
    !validIdentity(run.run_id) || !taskMap.has(run.task_id) || !validHash(run.run_row_sha256))) throw new Error('Pilot evidence diagnostics identities rejected.');
  const grouped = new Map(); let invalid = 0;
  for (const annotation of assessments) {
    if (!validIdentity(annotation?.run_id)) { invalid++; continue; }
    const run = runMap.get(annotation?.run_id); const task = run && taskMap.get(run.task_id);
    const valid = run?.quality?.evidence_complete === false && annotation.task_id === run.task_id &&
      annotation.run_row_sha256 === run.run_row_sha256 && causes.includes(annotation.primary_cause) &&
      Array.isArray(annotation.requirement_ids) && annotation.requirement_ids.length > 0 &&
      new Set(annotation.requirement_ids).size === annotation.requirement_ids.length &&
      annotation.requirement_ids.every(id => task.required_evidence.includes(id)) &&
      Array.isArray(annotation.proof_sha256s) && annotation.proof_sha256s.length > 0 && annotation.proof_sha256s.every(validHash) &&
      Array.isArray(annotation.proofs) && annotation.proofs.length > 0 && annotation.proofs.every(proof =>
        validHash(proof?.sha256) && annotation.proof_sha256s.includes(proof.sha256)) &&
      annotation.proofs.some(proof => proof.kind === proofKinds[annotation.primary_cause]);
    const list = grouped.get(annotation?.run_id) ?? [];
    list.push({ annotation, valid: Boolean(valid) }); grouped.set(annotation?.run_id, list);
    if (!valid) invalid++;
  }
  const summarize = split => {
    const cohort = runs.filter(run => taskMap.get(run.task_id).split === split);
    const omitted = cohort.filter(run => run.quality?.evidence_complete === false);
    const result = { attempt_count: cohort.length, omission_attempt_count: omitted.length, cause_counts: emptyCounts(),
      unassessed_attempt_count: 0, unknown_quality_attempt_count: cohort.filter(run =>
        ![true, false].includes(run.quality?.evidence_complete)).length, variant_counts: {}, details: [] };
    for (const variant of ['baseline', 'deterministic', 'hybrid']) result.variant_counts[variant] = {
      attempt_count: cohort.filter(run => run.variant === variant).length,
      omission_attempt_count: omitted.filter(run => run.variant === variant).length, cause_counts: emptyCounts() };
    for (const run of omitted) {
      const entries = grouped.get(run.run_id) ?? []; const valid = entries.filter(entry => entry.valid);
      const distinct = new Set(valid.map(entry => pilotAssessmentIdentity(entry.annotation)));
      const accepted = valid.length === entries.length && distinct.size === 1 ? valid[0]?.annotation : null;
      if (distinct.size > 1) invalid += valid.length;
      const cause = accepted?.primary_cause ?? 'unknown'; result.cause_counts[cause]++;
      if (Object.hasOwn(result.variant_counts, run.variant)) result.variant_counts[run.variant].cause_counts[cause]++;
      if (!entries.length) result.unassessed_attempt_count++;
      result.details.push({ run_id: run.run_id, task_id: run.task_id, run_row_sha256: run.run_row_sha256,
        requirement_ids: accepted?.requirement_ids ?? [], proof_sha256s: accepted?.proof_sha256s ?? [],
        primary_cause: cause, annotation_accepted: Boolean(accepted) });
    }
    return result;
  };
  const heldOut = summarize('held_out'); const tuning = summarize('tuning');
  return { diagnostic_version: 1, ...heldOut, invalid_assessment_count: invalid, tuning,
    limitations: ['Cause annotations are owner-attested diagnostics, not machine-proven correctness.',
      'Original grades and corpus remain unchanged.', 'Missing or contradictory proof remains unknown.'] };
}
