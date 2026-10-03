import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPrivateTaskSnapshot, resolvePrivateTaskReference } from '../src/task-usage-transcript.mjs';
import { diagnosePilotEvidence } from '../src/pilot-evidence-diagnostics.mjs';

/** Load frozen pilot rows with exact byte hashes and private annotations; returned details stay private. */
export async function loadPilotEvidenceDiagnostic(options) {
  const canonical = await fs.readFile(new URL('../evaluation/tasks.jsonl', import.meta.url));
  const tasksBytes = await fs.readFile(options.tasks);
  if (!tasksBytes.equals(canonical)) throw new Error('Pilot evidence corpus rejected.');
  const directory = dirname(resolve(options.assessments));
  const runPath = await resolvePrivateTaskReference(directory, basename(resolve(options.runs)));
  if (runPath !== resolve(options.runs)) throw new Error('Pilot evidence run reference rejected.');
  const annotationPath = await resolvePrivateTaskReference(directory, basename(resolve(options.assessments)));
  const runSource = await readPrivateTaskSnapshot(runPath); const annotationSource = await readPrivateTaskSnapshot(annotationPath);
  const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const rows = decode(runSource.data).split('\n').filter(line => line.trim());
  const runs = rows.map(line => ({ ...JSON.parse(line), run_row_sha256: createHash('sha256').update(Buffer.from(line)).digest('hex') }));
  const annotations = decode(annotationSource.data).split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  const tasks = decode(canonical).split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  const result = diagnosePilotEvidence(tasks, runs, annotations);
  result.source_hashes = { corpus: createHash('sha256').update(canonical).digest('hex'),
    runs: runSource.source_sha256, assessments: annotationSource.source_sha256 };
  return result;
}

const entry = process.argv[1] ? await fs.realpath(process.argv[1]).catch(() => null) : null;
if (entry && import.meta.url === pathToFileURL(entry).href) {
  try {
    const args = process.argv.slice(2), options = {};
    while (args.length) {
      const flag = args.shift();
      if (!['--tasks', '--runs', '--assessments'].includes(flag) || !args.length || options[flag.slice(2)]) throw new Error();
      options[flag.slice(2)] = args.shift();
    }
    if (Object.keys(options).length !== 3) throw new Error();
    const { details, tuning, ...result } = await loadPilotEvidenceDiagnostic(options);
    const { details: tuningDetails, ...tuningSummary } = tuning;
    const output = JSON.stringify({ ...result, tuning: tuningSummary });
    if (Buffer.byteLength(output) > 4_000_000) throw new Error();
    process.stdout.write(output + '\n');
  } catch {
    process.stdout.write(JSON.stringify({ diagnostic_version: 1, available: false, limitations: ['Private diagnostic input rejected.'] }) + '\n');
    process.stderr.write('Pilot evidence diagnostics rejected private input.\n'); process.exitCode = 1;
  }
}
