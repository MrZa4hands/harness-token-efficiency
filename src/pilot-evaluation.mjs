import { readFile, mkdir, readdir, writeFile, rename, unlink, open, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const usageFields = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
const unknownCodexUsage = () => Object.fromEntries([['available', false], ...usageFields.map(field => [field, null])]);
const corpusCategories = new Set(['code_analysis', 'review', 'documentation', 'checks', 'follow_up', 'exhaustive']);
const fixturePath = new URL('../evaluation/pilot-fixture.json', import.meta.url);

/** Collect cumulative token usage for supplied thread epochs; task/worker coverage is separate. */
export function collectCodexUsage(events, clientVersion) {
  if (!['0.159.2', '0.159.3'].includes(clientVersion) || !Array.isArray(events) || events.length === 0) return unknownCodexUsage();
  const snapshots = new Map();
  for (const event of events) {
    if (!event || [event.session_id, event.thread_id, event.counter_epoch].some(id => typeof id !== 'string' || !id)) return unknownCodexUsage();
    const usage = event.usage;
    if (!usage || usageFields.some(field => !Number.isSafeInteger(usage[field]) || usage[field] < 0) ||
        usage.cached_input_tokens > usage.input_tokens || usage.cache_write_input_tokens > usage.input_tokens ||
        usage.reasoning_output_tokens > usage.output_tokens || usage.total_tokens !== usage.input_tokens + usage.output_tokens) return unknownCodexUsage();
    const key = JSON.stringify([event.session_id, event.thread_id, event.counter_epoch]);
    const previous = snapshots.get(key);
    if (previous && usageFields.some(field => usage[field] < previous[field])) return unknownCodexUsage();
    snapshots.set(key, usage);
  }
  const totals = Object.fromEntries([['available', true], ...usageFields.map(field => [field, 0])]);
  for (const usage of snapshots.values()) for (const field of usageFields) {
    totals[field] += usage[field];
    if (!Number.isSafeInteger(totals[field])) return unknownCodexUsage();
  }
  return totals;
}

function isPilotRelativePath(path) {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.includes('\\') &&
    !path.split('/').some(part => ['..', '.', '.git', '.codex', ''].includes(part));
}

/** Validate pilot corpus identities and expected evidence; conversations cannot cross tuning splits. */
export function validatePilotCorpus(tasks) {
  const errors = [];
  if (!Array.isArray(tasks) || tasks.length === 0) return { valid: false, errors: ['Pilot corpus has no tasks.'] };
  const identities = new Set();
  const conversations = new Map();
  for (const task of tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) { errors.push('Pilot corpus task is not an object.'); continue; }
    const id = typeof task.task_id === 'string' ? task.task_id : '<missing>';
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || identities.has(id)) errors.push(`Pilot corpus task identity invalid or duplicate: ${id}`);
    identities.add(id);
    if (!['held_out', 'tuning'].includes(task.split) || !corpusCategories.has(task.category)) errors.push(`Pilot corpus split/category invalid: ${id}`);
    if (typeof task.conversation_id !== 'string' || !task.conversation_id) errors.push(`Pilot corpus conversation missing: ${id}`);
    else {
      const split = conversations.get(task.conversation_id);
      if (split && split !== task.split) errors.push(`Pilot corpus conversation crosses tuning and held-out: ${id}`);
      conversations.set(task.conversation_id, task.split);
    }
    if (!/^[a-f0-9]{40}$/.test(task.initial_revision ?? '')) errors.push(`Pilot corpus initial revision invalid: ${id}`);
    if (typeof task.prompt !== 'string' || !task.prompt.trim()) errors.push(`Pilot corpus prompt missing: ${id}`);
    if (!Array.isArray(task.expected_checks) || task.expected_checks.some(check => typeof check !== 'string' || !check)) errors.push(`Pilot corpus expected checks invalid: ${id}`);
    if (!Array.isArray(task.required_evidence) || !task.required_evidence.length || task.required_evidence.some(path => !isPilotRelativePath(path))) errors.push(`Pilot corpus required evidence invalid: ${id}`);
    if (!Array.isArray(task.expected_outcome?.assertions) || !task.expected_outcome.assertions.length ||
        task.expected_outcome.assertions.some(value => typeof value !== 'string' || !value.trim())) errors.push(`Pilot corpus verifiable outcome missing: ${id}`);
    if (task.fixture && (!['baseline', 'changes'].includes(task.fixture.variant) || !/^[a-f0-9]{64}$/.test(task.fixture.sha256 ?? ''))) errors.push(`Pilot corpus fixture fingerprint invalid: ${id}`);
  }
  return { valid: errors.length === 0, errors };
}

/** Materialize the versioned pilot fixture only in an empty, explicitly requested directory. */
export async function materializePilotFixture(repoRoot, variant = 'baseline') {
  if (!['baseline', 'changes'].includes(variant)) throw new Error('Pilot fixture variant invalid');
  const root = resolve(repoRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await readdir(root)).length !== 0) throw new Error('Pilot fixture directory must be empty');
  const fixtureText = await readFile(fixturePath, 'utf8');
  const fixture = JSON.parse(fixtureText);
  const files = { ...fixture.files };
  for (let index = 0; index < fixture.archive_count; index++) {
    const ordinal = String(index).padStart(4, '0');
    files[`src/archive/record-${ordinal}.mjs`] = `export const archiveRecord${ordinal} = ${index};\n`;
  }
  const writeFixtureFile = async (path, content) => {
    if (!isPilotRelativePath(path) || typeof content !== 'string') throw new Error('Pilot fixture file invalid');
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, content, { mode: 0o600 });
  };
  for (const [path, content] of Object.entries(files)) await writeFixtureFile(path, content);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Pilot Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Pilot Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00+00:00', GIT_COMMITTER_DATE: '2026-01-01T00:00:00+00:00' };
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
    '-c', 'core.autocrlf=false', '-c', 'core.excludesFile=/dev/null', '-c', 'core.attributesFile=/dev/null',
    ...args], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '--initial-branch=fixture-base', '--object-format=sha1']);
  git(['add', '--all']);
  git(['commit', '-m', 'test: establish reproducible issue report fixture']);
  const initialRevision = git(['rev-parse', 'HEAD']).trim();
  if (variant === 'changes') {
    for (const [path, content] of Object.entries(fixture.changes.staged)) { await writeFixtureFile(path, content); git(['add', '--', path]); }
    for (const [path, content] of Object.entries(fixture.changes.unstaged)) await writeFixtureFile(path, content);
    for (const [path, content] of Object.entries(fixture.changes.untracked)) await writeFixtureFile(path, content);
    for (const [from, to] of Object.entries(fixture.changes.renamed)) {
      if (!isPilotRelativePath(from) || !isPilotRelativePath(to)) throw new Error('Pilot fixture rename invalid');
      await rename(join(root, from), join(root, to));
      git(['add', '-A', '--', from, to]);
    }
    for (const path of fixture.changes.deleted) {
      if (!isPilotRelativePath(path)) throw new Error('Pilot fixture deletion invalid');
      await unlink(join(root, path));
    }
  }
  return { initial_revision: initialRevision, fixture_sha256: createHash('sha256').update(fixtureText).digest('hex') };
}

async function readCodexTranscript(transcriptPath, clientVersion) {
  const file = await open(transcriptPath, 'r');
  let finalNewline;
  let snapshotSize;
  try {
    const stat = await file.stat();
    snapshotSize = stat.size;
    const lastByte = Buffer.alloc(1);
    if (stat.size) await file.read(lastByte, 0, 1, stat.size - 1);
    finalNewline = stat.size > 0 && lastByte[0] === 10;
  } finally { await file.close(); }
  if (snapshotSize === 0) return { usage: unknownCodexUsage(), trailingIncomplete: false };
  const stream = createReadStream(transcriptPath, { encoding: 'utf8', end: snapshotSize - 1 });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const events = [];
  let sessionId;
  let invalidFinalLine;
  let trailingIncomplete = false;
  try {
    for await (const line of lines) {
      if (invalidFinalLine !== undefined) throw new Error('Codex usage transcript has a corrupt interior line');
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch (error) {
        const position = / in JSON at position (\d+) \(line \d+ column \d+\)$/.exec(error.message);
        invalidFinalLine = { text: line, incomplete: error instanceof SyntaxError &&
          (error.message === 'Unexpected end of JSON input' || (position && Number(position[1]) === line.length)) };
        continue;
      }
      if (event?.type === 'session_meta') {
        const metadata = event.payload;
        if (metadata?.cli_version !== clientVersion || typeof metadata?.id !== 'string') throw new Error('Codex usage transcript version or identity mismatch');
        if (sessionId && sessionId !== metadata.id) throw new Error('Codex usage transcript changes session identity');
        sessionId = metadata.id;
      } else if (event?.type === 'event_msg' && event.payload?.type === 'token_count' && event.payload.info !== null) {
        if (!sessionId || !event.payload.info?.total_token_usage) throw new Error('Codex usage transcript counter lacks verified identity or data');
        events.push({ session_id: sessionId, thread_id: sessionId, counter_epoch: '0', usage: event.payload.info.total_token_usage });
      }
    }
    if (invalidFinalLine !== undefined) {
      if (finalNewline || !invalidFinalLine.incomplete || !invalidFinalLine.text.trim().startsWith('{')) throw new Error('Codex usage transcript has a corrupt final line');
      trailingIncomplete = true;
    }
  } finally { lines.close(); stream.destroy(); }
  return { usage: collectCodexUsage(events, clientVersion), trailingIncomplete };
}

const evaluationEntryPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
if (evaluationEntryPath && import.meta.url === pathToFileURL(evaluationEntryPath).href) {
  const args = process.argv.slice(2);
  const command = args.shift();
  const options = {};
  try {
    while (args.length) {
      const flag = args.shift();
      if (!['--transcript', '--client-version', '--tasks', '--repo', '--variant'].includes(flag) || !args.length || options[flag]) throw new Error('Pilot evaluation CLI arguments invalid');
      options[flag] = args.shift();
    }
    let result;
    if (command === 'usage' && options['--transcript'] && options['--client-version']) {
      const measured = await readCodexTranscript(options['--transcript'], options['--client-version']);
      result = { ...measured.usage, measurement_scope: 'session', worker_coverage_verified: false };
      if (measured.trailingIncomplete) process.stderr.write('Codex usage: ignored incomplete final line.\n');
      process.stderr.write('Codex usage: worker coverage and complete-task totals are unverified; no promotion from these counters.\n');
      if (!result.available) { process.stderr.write('Codex usage: unsupported version or invalid counters; totals unknown.\n'); process.exitCode = 1; }
    } else if (command === 'corpus' && options['--tasks']) {
      const text = await readFile(options['--tasks'], 'utf8');
      result = validatePilotCorpus(text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)));
      if (!result.valid) process.exitCode = 1;
    } else if (command === 'fixture' && options['--repo']) {
      result = await materializePilotFixture(options['--repo'], options['--variant'] ?? 'baseline');
    } else throw new Error('Pilot evaluation CLI: usage, corpus, or fixture arguments required');
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write('Pilot evaluation failed: ' + (error instanceof SyntaxError ? 'Malformed JSON input.' : error.message) + '\n');
    process.stdout.write(JSON.stringify(command === 'usage' ? { ...unknownCodexUsage(), measurement_scope: 'session', worker_coverage_verified: false } : { valid: false, errors: ['Input rejected.'] }) + '\n');
    process.exitCode = 1;
  }
}
