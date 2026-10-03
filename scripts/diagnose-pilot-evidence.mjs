import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readTaskFileSnapshot, resolvePrivateTaskReference, readTaskJsonlSnapshot,
  createTaskReadBudget } from '../src/task-usage-transcript.mjs';
import { fileURLToPath } from 'node:url';
import { diagnosePilotEvidence } from '../src/pilot-evidence-diagnostics.mjs';

/** Load frozen pilot rows with exact byte hashes and private annotations; returned details stay private. */
export async function loadPilotEvidenceDiagnostic(options) {
  try {
    const canonical = (await readTaskFileSnapshot(fileURLToPath(new URL('../evaluation/tasks.jsonl', import.meta.url)), 4_000_000, false)).data;
    const tasksBytes = (await readTaskFileSnapshot(options.tasks, canonical.length, false)).data;
    if (!tasksBytes.equals(canonical)) throw new Error('Pilot evidence corpus rejected.');
    const directory = dirname(resolve(options.assessments));
    const runPath = await resolvePrivateTaskReference(directory, basename(resolve(options.runs)));
    if (runPath !== resolve(options.runs)) throw new Error('Pilot evidence run reference rejected.');
    const annotationPath = await resolvePrivateTaskReference(directory, basename(resolve(options.assessments)));
    const budget = createTaskReadBudget(), runSources = [], annotations = [];
    const runSource = await readTaskJsonlSnapshot(runPath, { budget }, (row, run_row_sha256) => {
      runSources.push({ row: { run_id: row?.run_id, task_id: row?.task_id, variant: row?.variant,
        quality: { evidence_complete: row?.quality?.evidence_complete } }, run_row_sha256 });
    });
    const annotationSource = await readTaskJsonlSnapshot(annotationPath, { budget, allow_empty: true }, row => {
      const annotation = Object.fromEntries(['run_id', 'task_id', 'run_row_sha256', 'requirement_ids',
        'proof_sha256s', 'proofs', 'primary_cause'].filter(key => Object.hasOwn(row ?? {}, key)).map(key => [key, row[key]]));
      annotations.push(annotation);
    });
    const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const tasks = decode(canonical).split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    const result = diagnosePilotEvidence(tasks, runSources, annotations);
    result.source_hashes = { corpus: createHash('sha256').update(canonical).digest('hex'),
      runs: runSource.source_sha256, assessments: annotationSource.source_sha256 };
    return result;
  } catch { throw new Error('Pilot evidence diagnostic input rejected.'); }
}

// Save only to a new private descriptor; failure never exposes report contents or announces success.
async function savePrivatePilotEvidenceReport(path, report) {
  let file;
  try {
    const bytes = JSON.stringify(report) + '\n';
    if (Buffer.byteLength(bytes) > 4_000_000) throw new Error();
    const absolute = resolve(path), directory = dirname(absolute);
    if (await fs.realpath(directory) !== directory) throw new Error();
    const before = await fs.lstat(directory, { bigint: true });
    const privateDirectory = stat => stat.isDirectory() && !stat.isSymbolicLink() &&
      stat.uid === BigInt(process.getuid()) && (stat.mode & 0o077n) === 0n;
    if (!privateDirectory(before)) throw new Error();
    file = await fs.open(absolute, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
      constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    const stat = await file.stat({ bigint: true });
    const current = await fs.lstat(directory, { bigint: true });
    if (!stat.isFile() || stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o077n) !== 0n ||
        !privateDirectory(current) || current.dev !== before.dev || current.ino !== before.ino ||
        await fs.realpath(directory) !== directory) throw new Error();
    await file.writeFile(bytes); await file.sync();
    const after = await fs.lstat(directory, { bigint: true });
    if (!privateDirectory(after) || after.dev !== before.dev || after.ino !== before.ino ||
        await fs.realpath(directory) !== directory) throw new Error();
  } finally { await file?.close(); }
}

const entry = process.argv[1] ? await fs.realpath(process.argv[1]).catch(() => null) : null;
if (entry && import.meta.url === pathToFileURL(entry).href) {
  try {
    const args = process.argv.slice(2), options = {};
    while (args.length) {
      const flag = args.shift();
      if (!['--tasks', '--runs', '--assessments', '--output'].includes(flag) || !args.length ||
          Object.hasOwn(options, flag.slice(2)) || !args[0]) throw new Error();
      options[flag.slice(2)] = args.shift();
    }
    if (!['tasks', 'runs', 'assessments'].every(key => options[key])) throw new Error();
    const report = await loadPilotEvidenceDiagnostic(options);
    const { details, tuning, ...result } = report;
    const { details: tuningDetails, ...tuningSummary } = tuning;
    const output = JSON.stringify({ ...result, tuning: tuningSummary });
    if (Buffer.byteLength(output) > 4_000_000) throw new Error();
    if (Object.hasOwn(options, 'output')) await savePrivatePilotEvidenceReport(options.output, report);
    process.stdout.write(output + '\n');
  } catch {
    process.stdout.write(JSON.stringify({ diagnostic_version: 1, available: false, limitations: ['Private diagnostic input rejected.'] }) + '\n');
    process.stderr.write('Pilot evidence diagnostics rejected private input or output.\n'); process.exitCode = 1;
  }
}
