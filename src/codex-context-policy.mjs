import { readFile, realpath, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';

/** @typedef {{mode:'off'|'shadow'|'enforce',jev_enabled:boolean,operations:Record<string,'off'|'shadow'|'enforce'>}} ContextPolicyConfig */

const contextModes = new Set(['off', 'shadow', 'enforce']);

/** Read context policy on every call; missing, invalid, or external configuration is off. */
export async function readContextPolicyConfig(repoRoot, signal) {
  const disabled = { mode: 'off', jev_enabled: true, operations: {} };
  try {
    const root = await realpath(repoRoot);
    const configPath = await realpath(join(root, '.codex/codex-context-policy.json'));
    const pathInsideRoot = relative(root, configPath);
    if (pathInsideRoot.startsWith('..') || isAbsolute(pathInsideRoot)) return disabled;
    let file; let text;
    try {
      file = await open(configPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 32000) return disabled;
      text = await file.readFile({ encoding: 'utf8', signal });
      if (Buffer.byteLength(text) > 32000) return disabled;
    } finally { await file?.close(); }
    const config = JSON.parse(text);
    if (!config || !contextModes.has(config.mode) || typeof config.jev_enabled !== 'boolean') return disabled;
    const operations = config.operations ?? {};
    if (typeof operations !== 'object' || operations === null || Array.isArray(operations) ||
        Object.values(operations).some(value => !contextModes.has(value))) return disabled;
    if (config.jev_model !== undefined && (typeof config.jev_model !== 'string' || !/^[A-Za-z0-9._:/-]{1,128}$/.test(config.jev_model))) return disabled;
    return { mode: config.mode, jev_enabled: config.jev_enabled, operations,
      ...(config.jev_model === undefined ? {} : { jev_model: config.jev_model }) };
  } catch {
    return disabled;
  }
}

/** Handle a Codex hook without network, repository commands, or output while off. */
export async function handleCodexHook(input) {
  const unchanged = { stdout: '', stderr: '', exit_code: 0 };
  if (!input || typeof input.cwd !== 'string' || typeof input.session_id !== 'string' ||
      typeof input.hook_event_name !== 'string') return unchanged;
  const signal = AbortSignal.timeout(2000);
  const config = await readContextPolicyConfig(input.cwd, signal);
  if (config.mode === 'off') return unchanged;
  if (input.hook_event_name !== 'UserPromptSubmit' || typeof input.prompt !== 'string') return unchanged;
  try {
    const { readContextTask, captureContextTask, saveContextTask, resolveContextFacts,
      resolveContextDecision, recordContextDecision } = await import('./context-state.mjs');
    const { minimizeJevState, queryJevContext } = await import('./jev-client.mjs');
    const { readJevCredential } = await import('./context-credentials.mjs');
    const questions = JSON.parse(await readFile(new URL('../config/jev-questions.json', import.meta.url), 'utf8'));
    const stateDir = join(homedir(), '.codex/codex-context-policy');
    const previous = await readContextTask(stateDir, input.cwd, input.session_id);
    const versions = { client_version: typeof input.client_version === 'string' && /^\d+\.\d+\.\d+$/.test(input.client_version) ? input.client_version : 'unverified',
      jev_model: null, questions_hash: createHash('sha256').update(JSON.stringify(questions)).digest('hex'),
      policy_hash: createHash('sha256').update(JSON.stringify(config)).digest('hex') };
    const state = await captureContextTask({ ...input, signal, versions }, previous);
    const facts = resolveContextFacts(state);
    let decision = resolveContextDecision(state, facts, null);
    if (decision.action === 'baseline' && config.jev_enabled) {
      const minimized = minimizeJevState(state, facts);
      if (!minimized || !config.jev_model) decision.fallback_reason = !minimized ? 'unsafe-request' : 'missing-model';
      else {
        const classified = await queryJevContext({ model: config.jev_model, state: minimized, questions },
          { apiKey: await readJevCredential(signal), signal, mode: config.mode, jevEnabled: config.jev_enabled });
        decision = resolveContextDecision(state, facts, classified.response);
        decision.duration_ms = classified.duration_ms;
        decision.provider_attempts = classified.request_sent ? 1 : 0;
        if (classified.status !== 'ok') decision.fallback_reason = classified.fallback_reason;
        state.versions = decision.versions;
        if (classified.status === 'ok' && state.continuity === 'unknown' &&
            !['contradictory-classification', 'uncertain-classification', 'invalid-response'].includes(decision.fallback_reason)) {
          if (classified.response.answers.continues_active_goal.noul <= 1 - 0.90) {
            state.active_request = state.recent_requests.at(-1);
            state.context_epoch = randomUUID(); state.continuity = 'new';
          } else if (classified.response.answers.continues_active_goal.noul >= 0.90) state.continuity = 'known';
        }
      }
    }
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
  if (process.argv[2] === 'setup-jev') {
    try {
      const args = process.argv.slice(3);
      if (args[0] !== '--repo' || !args[1] || (args.length !== 2 &&
          !(args.length === 4 && args[2] === '--model' && args[3]))) throw new Error('Invalid setup arguments');
      const { configureJevModel } = await import('./jev-client.mjs');
      const { readJevCredential } = await import('./context-credentials.mjs');
      const result = await configureJevModel(args[1], { model: args[3], apiKey: await readJevCredential() });
      process.stdout.write(JSON.stringify(result) + '\n');
      process.exitCode = result.status === 'ok' ? 0 : 1;
    } catch { process.stderr.write('Context Jev setup rejected; configuration preserved.\n'); process.exitCode = 1; }
  } else if (process.argv[2] !== 'hook') {
    process.stderr.write('Context policy CLI: expected operation hook or setup-jev.\n');
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
