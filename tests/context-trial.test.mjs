import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, realpath, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { materializePilotFixture } from '../src/pilot-evaluation.mjs';
import { captureRepositorySnapshot } from '../src/context-state.mjs';
import { readContextTask } from '../src/context-state.mjs';

const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'context-trial-tests-')));
after(() => assert.equal(spawnSync('trash', [temporaryRoot]).status, 0));

// A final short follow-up must consume the admitted preceding turns, never fabricated prompt concatenation or missing history.
test('native_trial_requires_ordered_prior_conversation_turns', async () => {
  const root = join(temporaryRoot, 'conversation-fixture'); await materializePilotFixture(root);
  const tasksPath = resolve('evaluation/tasks.jsonl');
  const task = (await readFile(tasksPath, 'utf8')).trim().split('\n').map(JSON.parse).find(row => row.task_id === 'follow_up_04');
  assert.equal(task.prior_requests.length, 2);
  const snapshot = await captureRepositorySnapshot(root); const admissionPath = join(temporaryRoot, 'conversation-admission.json');
  const admission = { version: 1, run_id: 'conversation-owner-trial', repo_root: root, repo_revision: snapshot.repo_revision,
    task_id: task.task_id, variant: 'baseline', main_model: 'fixture-main-model', reasoning_effort: 'medium',
    client_version: '0.159.2', expires_at: new Date(Date.now() + 60000).toISOString() };
  const home = join(temporaryRoot, 'conversation-home'); await mkdir(home);
  const bootstrap = join(temporaryRoot, 'conversation-home.mjs');
  await writeFile(bootstrap, "import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';" +
    'os.homedir=()=>'+JSON.stringify(home)+';syncBuiltinESMExports();\n');
  const session = 'ordered-conversation'; const stateDir = join(home, '.codex/codex-context-policy');
  const invoke = async (index, prompt) => {
    await writeFile(admissionPath, JSON.stringify({ ...admission, prompt_index: index }), { mode: 0o600 });
    return spawnSync(process.execPath, ['--import', bootstrap, resolve('src/pilot-evaluation.mjs'), 'trial', '--tasks', tasksPath,
      '--admission', admissionPath], { encoding: 'utf8', timeout: 3000, input: JSON.stringify({ cwd: root,
      session_id: session, turn_id: 'ordered-turn-' + index, hook_event_name: 'UserPromptSubmit', prompt,
      model: admission.main_model, reasoning_effort: admission.reasoning_effort, client_version: admission.client_version }) });
  };
  assert.equal((await invoke(0, task.prior_requests[0])).status, 0);
  let state = await readContextTask(stateDir, root, session);
  assert.equal(state?.recent_requests[0]?.text, task.prior_requests[0], 'Admitted first turn must actually capture isolated history');
  await invoke(2, task.prompt);
  assert.equal((await readContextTask(stateDir, root, session)).turn_id, 'ordered-turn-0', 'Skipping a prior turn must not bless final history');
  await invoke(1, task.prior_requests[1]); await invoke(2, task.prompt);
  state = await readContextTask(stateDir, root, session);
  assert.deepEqual(state.recent_requests.map(row => row.text), [...task.prior_requests, task.prompt]);
  assert.equal(state.turn_id, 'ordered-turn-2');
});

// An experimental hook must never inject for another prompt, root, model, task, revision or expired admission.
test('native_trial_is_bound_to_the_declared_corpus_and_repository', async () => {
  const root = join(temporaryRoot, 'fixture');
  await materializePilotFixture(root);
  await writeFile(join(root, '.git/info/exclude'), '.codex/\n.agents/\n');
  const tasksPath = resolve('evaluation/tasks.jsonl');
  const tasks = (await readFile(tasksPath, 'utf8')).trim().split('\n').map(JSON.parse);
  const task = tasks.find(task => task.task_id === 'documentation_01');
  const snapshot = await captureRepositorySnapshot(root);
  const admissionPath = join(temporaryRoot, 'admission.json');
  const admission = { version: 1, run_id: 'owner-trial', repo_root: root, repo_revision: snapshot.repo_revision,
    task_id: task.task_id, variant: 'deterministic', main_model: 'fixture-main-model',
    reasoning_effort: 'medium', client_version: '0.159.2', expires_at: new Date(Date.now() + 60_000).toISOString() };
  await writeFile(admissionPath, JSON.stringify(admission), { mode: 0o600 });
  await mkdir(join(root, '.codex'), { mode: 0o700 });
  await writeFile(join(root, '.codex/codex-context-trial.json'), JSON.stringify(admission), { mode: 0o600 });
  const isolatedHome = join(temporaryRoot, 'home'); await mkdir(isolatedHome);
  const bootstrap = join(temporaryRoot, 'isolated-home.mjs');
  await writeFile(bootstrap, "import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module';\n" +
    'os.homedir = () => ' + JSON.stringify(isolatedHome) + '; syncBuiltinESMExports();\n');
  const input = { cwd: root, session_id: 'trial-session', turn_id: 'trial-turn', hook_event_name: 'UserPromptSubmit',
    prompt: task.prompt, model: 'fixture-main-model', reasoning_effort: 'medium', client_version: '0.159.2', permission_mode: 'dontAsk' };
  const invoke = (nativeInput = input, extra = []) => spawnSync(process.execPath,
    ['--import', bootstrap, resolve('src/pilot-evaluation.mjs'), 'trial', '--tasks', tasksPath, '--admission', admissionPath, ...extra],
    { input: JSON.stringify(nativeInput), encoding: 'utf8', timeout: 3000 });
  const accepted = invoke();
  assert.equal(accepted.status, 0, 'A valid temporary native handler must retain the hook protocol: ' + accepted.stderr);
  assert.ok(accepted.stdout, 'Declared deterministic corpus preparation must be delivered before generation');
  const context = JSON.parse(accepted.stdout).hookSpecificOutput;
  assert.equal(context.hookEventName, 'UserPromptSubmit');
  assert.ok(Buffer.byteLength(context.additionalContext) <= 6000);
  assert.ok(context.additionalContext.includes('docs/labels.md'));
  const direct = spawnSync(process.execPath, ['--import', bootstrap, resolve('src/pilot-evaluation.mjs'), 'trial',
    '--tasks', tasksPath, '--task', task.task_id, '--variant', 'deterministic', '--repo', root],
    { input: JSON.stringify({ ...input, session_id: 'direct-trial-session' }), encoding: 'utf8', timeout: 3000 });
  assert.ok(direct.stdout, 'The planned per-task trial command reads its private repository admission');
  const failureBootstrap = join(temporaryRoot, 'failed-observation.mjs');
  await writeFile(failureBootstrap, "import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';\n" +
    "const original = fs.writeFile; fs.writeFile = (path, ...args) => String(path).includes('trial-observation-') ? Promise.reject(new Error('Synthetic disk failure')) : original(path, ...args); syncBuiltinESMExports();\n");
  const unobserved = spawnSync(process.execPath, ['--import', bootstrap, '--import', failureBootstrap,
    resolve('src/pilot-evaluation.mjs'), 'trial', '--tasks', tasksPath, '--admission', admissionPath],
    { input: JSON.stringify({ ...input, session_id: 'unobserved-session' }), encoding: 'utf8', timeout: 3000 });
  assert.equal(unobserved.stdout, '', 'Experimental evidence cannot be emitted when its audit write fails');
  const delayedBootstrap = join(temporaryRoot, 'delayed-observation.mjs');
  await writeFile(delayedBootstrap, "import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';\n" +
    'const original = fs.writeFile; fs.writeFile = async (path, ...args) => { const result = await original(path, ...args); ' +
    "if (String(path).includes('trial-observation-')) await new Promise(resolve => setTimeout(resolve, 2200)); return result; }; syncBuiltinESMExports();\n");
  const delayed = spawnSync(process.execPath, ['--import', bootstrap, '--import', delayedBootstrap,
    resolve('src/pilot-evaluation.mjs'), 'trial', '--tasks', tasksPath, '--admission', admissionPath],
    { input: JSON.stringify({ ...input, session_id: 'delayed-observation-session' }), encoding: 'utf8', timeout: 6000 });
  assert.equal(delayed.status, 0, delayed.stderr);
  assert.equal(delayed.stdout, '', 'An audit write past the shared deadline must discard experimental context');
  assert.match(delayed.stderr, /Context trial audit unavailable/);
  const observations = await Promise.all((await readdir(temporaryRoot)).filter(name => name.startsWith('trial-observation-'))
    .map(name => readFile(join(temporaryRoot, name), 'utf8').then(JSON.parse)));
  const delayedAudit = observations.find(record => record.session_id === 'delayed-observation-session');
  assert.equal(delayedAudit.emission_attempted, true);
  assert.equal(delayedAudit.emitted, false, 'A pre-output audit cannot certify emission');
  assert.equal(delayedAudit.delivery_confirmed, false);
  assert.equal(delayedAudit.measurement_scope, 'hook-preparation-before-audit', 'Audit duration exclusions must be explicit');
  assert.equal(await readFile(join(root, '.codex/codex-context-policy.json')).then(() => true, error => error.code !== 'ENOENT'), false,
    'An experimental handler cannot install or activate production policy');
  // Native UPS omits version/effort; only metadata for this exact session and active turn may supply them.
  const sessionDirectory = join(isolatedHome, '.codex/sessions/2026/10/01'); await mkdir(sessionDirectory, { recursive: true });
  const transcriptPath = join(sessionDirectory, 'rollout-current.jsonl');
  const metadataInput = { ...input, session_id: 'transcript-session', turn_id: 'transcript-turn', transcript_path: transcriptPath };
  delete metadataInput.client_version; delete metadataInput.reasoning_effort;
  const transcript = [ { type: 'session_meta', payload: { id: metadataInput.session_id, cli_version: '0.159.2', cwd: root } },
    { type: 'turn_context', payload: { turn_id: metadataInput.turn_id, cwd: root, model: input.model, effort: 'medium' } } ];
  await writeFile(transcriptPath, transcript.map(JSON.stringify).join('\n') + '\n', { mode: 0o644 });
  assert.ok(invoke(metadataInput).stdout, 'Verified current native transcript metadata supplies omitted version/effort');
  await writeFile(transcriptPath, JSON.stringify(transcript[0]) + '\n' + JSON.stringify({ ...transcript[1],
    payload: { ...transcript[1].payload, turn_id: 'previous-turn' } }) + '\n');
  assert.equal(invoke(metadataInput).stdout, '', 'A previous turn cannot establish the active reasoning effort');
  const foreignTranscript = join(temporaryRoot, 'foreign-transcript.jsonl');
  await writeFile(foreignTranscript, transcript.map(JSON.stringify).join('\n') + '\n', { mode: 0o600 });
  assert.equal(invoke({ ...metadataInput, transcript_path: foreignTranscript }).stdout, '', 'Repository-controlled transcripts cannot supply native identity');
  for (const nativeInput of [ { ...input, prompt: 'Another objective' }, { ...input, cwd: temporaryRoot },
    { ...input, model: 'another-model' }, { ...input, reasoning_effort: 'high' }, { ...input, is_subagent: true } ]) {
    assert.equal(invoke(nativeInput).stdout, '', 'Unmatched native input retains baseline');
  }
  for (const changed of [ { ...admission, task_id: 'unknown-task' }, { ...admission, repo_revision: 'f'.repeat(64) },
    { ...admission, expires_at: '2020-01-01T00:00:00Z' }, { ...admission, main_model: 'unverified' } ]) {
    await writeFile(admissionPath, JSON.stringify(changed)); assert.equal(invoke().stdout, '');
  }
  await writeFile(admissionPath, JSON.stringify({ ...admission, variant: 'baseline' }));
  assert.equal(invoke().stdout, '', 'Experimental baseline never injects');
  await writeFile(admissionPath, JSON.stringify(admission));
  assert.equal(invoke(input, ['--task', task.task_id, '--variant', 'deterministic', '--repo', root]).status, 0);
  assert.equal(invoke(input, ['--task', 'unknown-task', '--variant', 'deterministic', '--repo', root]).stdout, '');
  await writeFile(join(root, 'docs/labels.md'), 'Changed after admission.\n');
  assert.equal(invoke().stdout, '', 'Any raw repository change invalidates the admitted experiment');
});
