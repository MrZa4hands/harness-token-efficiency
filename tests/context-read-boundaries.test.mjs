import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import filesystem from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { captureContextTask, saveContextTask, resolveContextDecision, resolveContextFacts, recordContextDecision } from '../src/context-state.mjs';

const temporary = await realpath(await mkdtemp(join(tmpdir(), 'context-read-boundaries-')));
after(() => assert.equal(spawnSync('trash', [temporary]).status, 0));

// A FIFO or a regular-file-to-FIFO race must return baseline instead of blocking automatic preparation.
test('context_private_reads_reject_fifos_without_waiting_for_a_writer', async context => {
  for (const scenario of ['receipt', 'policy', 'task', 'inventory-race']) await context.test(scenario, async () => {
    const root = await mkdtemp(join(temporary, scenario + '-'));
    assert.equal(spawnSync('git', ['-c', 'init.templateDir=', 'init', '--initial-branch=fixture'], { cwd: root }).status, 0);
    await mkdir(join(root, '.codex'), { mode: 0o700 });
    const stateDir = join(root, 'private-state');
    const taskDir = join(stateDir, createHash('sha256').update(root).digest('hex'), createHash('sha256').update('fifo-session').digest('hex'));
    await mkdir(taskDir, { recursive: true, mode: 0o700 });
    const paths = { receipt: join(root, '.codex/codex-context-policy-install.json'),
      policy: join(root, '.codex/codex-context-policy.json'), task: join(taskDir, 'task.json'),
      'inventory-race': join(root, 'example.mjs') };
    if (scenario !== 'policy') await writeFile(paths.policy, JSON.stringify({ mode: 'shadow', jev_enabled: false }), { mode: 0o600 });
    if (scenario === 'inventory-race') await writeFile(paths[scenario], 'export const example = true;\n', { mode: 0o600 });
    else assert.equal(spawnSync('mkfifo', ['-m', '600', paths[scenario]]).status, 0);
    const program = `
      import filesystem from 'node:fs/promises';
      import { spawnSync } from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      import { pathToFileURL } from 'node:url';
      const [scenario,root,source,stateDir,target]=process.argv.slice(1);
      const input={cwd:root,session_id:'fifo-session',turn_id:'fifo-turn',hook_event_name:'UserPromptSubmit',prompt:'Inspect example.mjs.'};
      if(scenario==='inventory-race') {
        const original=filesystem.open; let replaced=false;
        filesystem.open=async(path,...args)=>{
          if(path===target&&!replaced){replaced=true;await filesystem.rename(target,target+'.regular');
            if(spawnSync('mkfifo',['-m','600',target]).status!==0)throw new Error('Fixture FIFO creation failed');}
          return original(path,...args);
        };syncBuiltinESMExports();
      }
      try {
        if(scenario==='task') await (await import(pathToFileURL(source+'/src/context-state.mjs'))).readContextTask(stateDir,root,input.session_id);
        else if(scenario==='inventory-race') await (await import(pathToFileURL(source+'/src/context-state.mjs'))).captureContextTask(input,null);
        else await (await import(pathToFileURL(source+'/src/codex-context-policy.mjs'))).handleCodexHook(input,scenario==='receipt'?source:undefined);
        console.log('baseline');
      } catch(error) { if(!error.message.startsWith('Context '))throw error;console.log('baseline'); }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program, scenario, root, resolve('.'), stateDir, paths[scenario]],
      { encoding: 'utf8', timeout: 2500, env: { ...process.env, HOME: root, TYPESAFE_API_KEY: '' } });
    assert.equal(result.status, 0, scenario + ' must return rather than hang until killed: ' + (result.error?.code ?? result.stderr));
    assert.equal(result.stdout.trim(), 'baseline');
  });
});

// Maintenance must not borrow a fresh sibling writer's lock or invalidate its task history.
test('retention_does_not_lock_a_fresh_sibling_session', async () => {
  const root = await mkdtemp(join(temporary, 'sibling-'));
  assert.equal(spawnSync('git', ['-c', 'init.templateDir=', 'init', '--initial-branch=fixture'], { cwd: root }).status, 0);
  await writeFile(join(root, 'example.mjs'), 'export const example = true;\n');
  const input = { cwd: root, session_id: 'active-sibling', hook_event_name: 'UserPromptSubmit', prompt: 'Inspect example.mjs.' };
  const stateDir = join(temporary, 'sibling-state');
  const initial = await captureContextTask(input, null); await saveContextTask(stateDir, initial);
  const next = await captureContextTask({ ...input, prompt: 'hazlo' }, initial);
  const observing = await captureContextTask({ ...input, session_id: 'observing' }, null);
  const path = join(stateDir, createHash('sha256').update(root).digest('hex'), createHash('sha256').update(input.session_id).digest('hex'), 'task.json');
  const realOpen = filesystem.open; let interleaved = false; let saved;
  const interception = mock.method(filesystem, 'open', async (target, ...args) => {
    const file = await realOpen(target, ...args);
    if (target === path && !interleaved) { interleaved = true; saved = await saveContextTask(stateDir, next); }
    return file;
  });
  syncBuiltinESMExports();
  try { await recordContextDecision(stateDir, observing, resolveContextDecision(observing, resolveContextFacts(observing), null)); }
  finally { interception.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(interleaved, true); assert.equal(saved, true, 'Optional pruning cannot force an unrelated active writer to lose its state');
});

// The deadline must still be enforced after file verification, during exact protected-path selection.
test('context_capture_deadline_covers_final_path_selection', async () => {
  const root = await mkdtemp(join(temporary, 'path-deadline-'));
  assert.equal(spawnSync('git', ['-c', 'init.templateDir=', 'init', '--initial-branch=fixture'], { cwd: root }).status, 0);
  const target = join(root, 'example.mjs'); await writeFile(target, 'export const example = true;\n');
  const realLstat = filesystem.lstat; const realNow = Date.now;
  let reads = 0; let expired = false;
  const clock = mock.method(Date, 'now', () => realNow() + (expired ? 2000 : 0));
  const checking = mock.method(filesystem, 'lstat', async path => {
    const stat = await realLstat(path);
    if (path === target && ++reads === 3) expired = true;
    return stat;
  });
  syncBuiltinESMExports();
  try { await assert.rejects(captureContextTask({ cwd: root, session_id: 'deadline', hook_event_name: 'UserPromptSubmit', prompt: 'Inspect example.mjs.' }, null), /Context inventory deadline/); }
  finally { checking.mock.restore(); clock.mock.restore(); syncBuiltinESMExports(); }
});
