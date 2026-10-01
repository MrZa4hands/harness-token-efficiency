import { readFile, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

/** @typedef {{mode:'off'|'shadow'|'enforce',jev_enabled:boolean,operations:Record<string,'off'|'shadow'|'enforce'>}} ContextPolicyConfig */

const contextModes = new Set(['off', 'shadow', 'enforce']);

/** Read context policy on every call; missing, invalid, or external configuration is off. */
export async function readContextPolicyConfig(repoRoot) {
  const disabled = { mode: 'off', jev_enabled: true, operations: {} };
  try {
    const root = await realpath(repoRoot);
    const configPath = await realpath(join(root, '.codex/codex-context-policy.json'));
    const pathInsideRoot = relative(root, configPath);
    if (pathInsideRoot.startsWith('..') || isAbsolute(pathInsideRoot)) return disabled;
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    if (!config || !contextModes.has(config.mode) || typeof config.jev_enabled !== 'boolean') return disabled;
    const operations = config.operations ?? {};
    if (typeof operations !== 'object' || operations === null || Array.isArray(operations) ||
        Object.values(operations).some(value => !contextModes.has(value))) return disabled;
    return { mode: config.mode, jev_enabled: config.jev_enabled, operations };
  } catch {
    return disabled;
  }
}

/** Handle a Codex hook without network, repository commands, or output while off. */
export async function handleCodexHook(input) {
  const unchanged = { stdout: '', stderr: '', exit_code: 0 };
  if (!input || typeof input.cwd !== 'string' || typeof input.session_id !== 'string' ||
      typeof input.hook_event_name !== 'string') return unchanged;
  const config = await readContextPolicyConfig(input.cwd);
  if (config.mode === 'off') return unchanged;
  if (input.hook_event_name !== 'UserPromptSubmit' || typeof input.prompt !== 'string') return unchanged;
  const signal = AbortSignal.timeout(2000);
  try {
    const { readContextTask, captureContextTask, saveContextTask, resolveContextFacts,
      resolveContextDecision, recordContextDecision } = await import('./context-state.mjs');
    const stateDir = join(homedir(), '.codex/codex-context-policy');
    const previous = await readContextTask(stateDir, input.cwd, input.session_id);
    const versions = { client_version: input.client_version ?? 'unverified', jev_model: null, questions_hash: null,
      policy_hash: createHash('sha256').update(JSON.stringify(config)).digest('hex') };
    const state = await captureContextTask({ ...input, signal, versions }, previous);
    const decision = resolveContextDecision(state, resolveContextFacts(state), null);
    signal.throwIfAborted();
    if (!await saveContextTask(stateDir, state)) return { ...unchanged, stderr: 'Context task state conflict; baseline retained.\n' };
    signal.throwIfAborted();
    await recordContextDecision(stateDir, state, decision);
  } catch (error) {
    const reason = /^Context [A-Za-z .;-]+$/.test(error.message) ? error.message : 'Context observation failed; baseline retained.';
    return { ...unchanged, stderr: reason + '\n' };
  }
  // Phase 1 observes decisions only; enforce also remains inert until measured promotion.
  return unchanged;
}

const policyEntryPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
if (policyEntryPath && import.meta.url === pathToFileURL(policyEntryPath).href) {
  if (process.argv[2] !== 'hook') {
    process.stderr.write('Context policy CLI: expected operation hook.\n');
    process.exitCode = 1;
  } else {
    try {
      let text = '';
      process.stdin.setEncoding('utf8');
      for await (const chunk of process.stdin) {
        text += chunk;
        if (Buffer.byteLength(text) > 1_000_000) throw new Error('Context hook input exceeds limit');
      }
      const result = await handleCodexHook(JSON.parse(text));
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      process.exitCode = result.exit_code;
    } catch {
      process.stderr.write('Context hook input rejected; baseline retained.\n');
    }
  }
}
