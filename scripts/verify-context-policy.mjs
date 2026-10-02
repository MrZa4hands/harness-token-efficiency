import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, lstat, access } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { validatePilotCorpus } from '../src/pilot-evaluation.mjs';

const root = resolve(process.cwd());
let failures = 0;
function reportGateFailure(message) { failures++; process.stderr.write('Context policy gate failed: ' + message + '\n'); }
function runGateCommand(args) {
  const childEnvironment = { ...process.env };
  delete childEnvironment.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env: childEnvironment });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.status !== 0 || result.error) reportGateFailure('node ' + args[0]);
}

try {
  const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim();
  if (resolve(gitRoot) !== root) throw new Error('Run the gate from the repository root.');
  const primaryCheckout = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim());
  const inventory = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  const paths = [...new Set(inventory.split('\0').filter(Boolean))].sort();
  if (!paths.length) throw new Error('Repository contains no source or documentation files.');
  const contents = new Map();
  for (const path of paths) {
    const target = resolve(root, path);
    const rel = relative(root, target);
    if (rel.startsWith('..') || resolve(root, rel) !== target) { reportGateFailure('Source path escapes repository.'); continue; }
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) { reportGateFailure('Source is not a regular file: ' + path); continue; }
    const text = await readFile(target, 'utf8');
    contents.set(path, text);
    const lineCount = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    if (lineCount > 500) reportGateFailure('File exceeds 500 lines: ' + path);
    if (path.endsWith('.mjs')) runGateCommand(['--check', target]);
    if (path.endsWith('.json') || path.endsWith('.jsonl')) {
      try {
        if (path.endsWith('.jsonl')) text.split('\n').filter(line => line.trim()).forEach(line => JSON.parse(line));
        else JSON.parse(text);
      } catch { reportGateFailure('Malformed JSON: ' + path); }
    }
    if (path.endsWith('.md')) {
      const prose = text.replace(/```[\s\S]*?```/g, '');
      const links = /\[[^\]\n]+\]\((?:<([^>]+)>|([^\s)]+))\)/g;
      for (const match of prose.matchAll(links)) {
        const href = match[1] ?? match[2];
        if (/^(?:https?:|mailto:|app:|plugin:|data:|#)/.test(href)) continue;
        let destination;
        try { destination = decodeURIComponent(href.split('#')[0]).replace(/:\d+$/, ''); }
        catch { reportGateFailure('Malformed document link: ' + path); continue; }
        if (!destination) continue;
        let referencePath = resolve(dirname(target), destination);
        // Sibling reference code is anchored at the primary checkout in linked worktrees.
        if (!destination.startsWith('/') && relative(root, referencePath).startsWith('..')) {
          referencePath = resolve(primaryCheckout, dirname(path), destination);
        }
        await access(referencePath).catch(() => {
          const reference = relative(root, referencePath);
          if (reference === '..' || reference.startsWith('../')) {
            process.stderr.write('Context policy gate warning: unavailable external reference in ' + path + ': ' + destination + '\n');
          } else reportGateFailure('Broken local document link in ' + path + ': ' + destination);
        });
      }
    }
  }
  const tests = paths.filter(path => path.startsWith('tests/') && path.endsWith('.test.mjs'));
  if (!tests.length) reportGateFailure('No behavioral tests found.');
  // ponytail: Isolate deadline-sensitive test files; revisit only if gate duration becomes a measured bottleneck.
  else runGateCommand(['--test', '--test-concurrency=1', ...tests.map(path => resolve(root, path))]);
  try {
    const corpusText = contents.get('evaluation/tasks.jsonl');
    if (corpusText === undefined) throw new Error('Pilot corpus is missing.');
    const tasks = corpusText.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    const corpus = validatePilotCorpus(tasks);
    if (!corpus.valid) throw new Error(corpus.errors.join('\n'));
    const heldOut = tasks.filter(task => task.split === 'held_out');
    const categories = ['code_analysis', 'review', 'documentation', 'checks', 'follow_up', 'exhaustive'];
    if (heldOut.length < 60 || categories.some(category => heldOut.filter(task => task.category === category).length < 10)) throw new Error('Pilot corpus requires at least ten held-out tasks in each category.');
    if (!tasks.some(task => task.split === 'tuning')) throw new Error('Pilot corpus requires separate tuning conversations.');
    const fixtureText = contents.get('evaluation/pilot-fixture.json');
    if (fixtureText === undefined) throw new Error('Pilot fixture is missing.');
    const fingerprint = createHash('sha256').update(fixtureText).digest('hex');
    if (tasks.some(task => task.fixture?.sha256 !== fingerprint)) throw new Error('Pilot corpus fixture fingerprint is stale.');
  } catch (error) { reportGateFailure(error instanceof SyntaxError ? 'Malformed pilot corpus.' : error.message); }
  if (!failures) process.stdout.write('Context policy gate passed: syntax, behavior, JSON/corpus, document links, and source scope.\n');
} catch (error) { reportGateFailure(error.message); }
process.exitCode = failures ? 1 : 0;
