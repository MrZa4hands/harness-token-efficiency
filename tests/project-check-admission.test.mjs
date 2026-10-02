import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checksFixture, refreshChecksFixture } from './project-checks.fixture.mjs';
import { runProjectChecks } from '../src/project-checks.mjs';
import { readContext } from '../src/context-results.mjs';

// Each batch member needs current admission; an earlier check can change the manager or remove a later declaration.
test('batch_checks_revalidate_current_declaration_before_execution', async () => {
  for (const change of ['unsupported', 'conflict', 'removed']) {
    const fixture = await checksFixture();
    await writeFile(join(fixture.root, 'switch.mjs'), "import {readFileSync,writeFileSync} from 'node:fs';" +
      "const p=JSON.parse(readFileSync('package.json'));const change=" + JSON.stringify(change) + ';' +
      "if(change==='unsupported')p.packageManager='pnpm@10.9.0';if(change==='removed')delete p.scripts.second;" +
      "writeFileSync('package.json',JSON.stringify(p));if(change==='conflict')writeFileSync('pnpm-lock.yaml','lockfileVersion: 9\\n');\n");
    await writeFile(join(fixture.root, 'second.mjs'), "import {writeFileSync} from 'node:fs';writeFileSync('.check-second-ran','ran');\n");
    await writeFile(join(fixture.root, 'package.json'), JSON.stringify({ ...fixture.manifest,
      scripts: { switch: 'node switch.mjs', second: 'node second.mjs' } }));
    await refreshChecksFixture(fixture);
    const results = await runProjectChecks({ ...fixture.request, checks: ['switch', 'second'] });
    assert.equal(results.length, 2); assert.equal(results[0].exit_code, 0); assert.equal(results[0].status, 'ok');
    assert.equal(results[1].executed, false); assert.equal(results[1].status, 'error'); assert.notEqual(results[1].exit_code, 0);
    assert.match(results[1].error, /manager|declaration/);
    await assert.rejects(access(join(fixture.root, '.check-second-ran')), 'Rejected batch member must not execute');
  }
});

// Native tools observe both CLI streams; duplicate previews must not exceed the whole routine-response budget.
test('check_cli_budgets_both_streams_without_duplicate_diagnostics', async () => {
  const fixture = await checksFixture(); const diagnostic = 'diagnosis line\n'.repeat(300);
  await writeFile(join(fixture.root, 'budget.mjs'), 'process.stderr.write(' + JSON.stringify(diagnostic) + ');process.exitCode=7;\n');
  await writeFile(join(fixture.root, 'package.json'), JSON.stringify({ ...fixture.manifest,
    scripts: Object.fromEntries(['test', 'one', 'two', 'three', 'four'].map(name => [name, 'node budget.mjs'])) }));
  await refreshChecksFixture(fixture);
  for (const checks of [['test'], ['one', 'two', 'three', 'four']]) {
    const cli = spawnSync(process.execPath, [resolve('src/codex-context-policy.mjs'), 'run_project_checks'],
      { input: JSON.stringify({ ...fixture.request, checks }), encoding: 'utf8', timeout: 10000 });
    assert.equal(cli.status, 7);
    const bytes = Buffer.byteLength(cli.stdout) + Buffer.byteLength(cli.stderr);
    assert.ok(bytes <= 8000, 'Combined routine CLI response exceeds 8000 bytes: ' + bytes);
    const results = JSON.parse(cli.stdout); assert.equal(results.length, checks.length);
    assert.ok(results.every(result => result.exit_code === 7 && result.status === 'error'));
    const result = results[0];
    const whole = await readContext({ ...fixture.request, reference: result.full_result, cursor: result.full_result + ':whole:1' });
    assert.equal(whole.entries[0]?.content, diagnostic); assert.equal(whole.exit_code, 7);
  }
});
