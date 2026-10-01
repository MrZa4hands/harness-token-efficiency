import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const text = readFileSync(new URL('../evaluation/tasks.jsonl', import.meta.url), 'utf8');
const corpusHash = createHash('sha256').update(text).digest('hex');
const tasks = text.trim().split('\n').map(row => JSON.parse(row)).filter(task => task.split === 'held_out');

// Synthetic owner-boundary data, never evidence of a real native execution or measured savings.
export function createContextPilotRuns(versions) {
  return tasks.flatMap((task, index) => ['baseline', 'deterministic', 'hybrid'].map((variant, order) => ({
    run_id: task.task_id + '-' + variant, task_id: task.task_id, split: 'held_out', family: 'code_context', variant,
    prompt_hash: createHash('sha256').update(task.prompt).digest('hex'), initial_revision: task.initial_revision,
    fixture_hash: task.fixture.sha256, corpus_hash: corpusHash, versions: { ...versions },
    native_execution_verified: true, task_coverage_verified: true, order_index: (order + index) % 3,
    cache_control: 'recorded', duration_ms: variant === 'baseline' ? 1000 : 900,
    codex_usage: { available: true, input_tokens: variant === 'baseline' ? 900 : 700, cached_input_tokens: 0,
      cache_write_input_tokens: 0, output_tokens: 100, reasoning_output_tokens: 0, total_tokens: variant === 'baseline' ? 1000 : 800 },
    jev_usage: { available: true, input_tokens: 0, output_tokens: 0, total_tokens: 0, requests: 0, models: [] },
    quality: { correct: true, critical_regression: false, evidence_complete: true, checks_complete: true },
  })));
}
