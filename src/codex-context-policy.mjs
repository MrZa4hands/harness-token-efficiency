import { readFile, realpath, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';

/** @typedef {{mode:'off'|'shadow'|'enforce',jev_enabled:boolean,operations:Record<string,'off'|'shadow'|'enforce'>}} ContextPolicyConfig */

const contextModes = new Set(['off', 'shadow', 'enforce']);

async function ownsContextPolicyInstall(repoRoot, sourceRoot, signal) {
  let file;
  try {
    const root = await realpath(repoRoot); const directory = join(root, '.codex');
    if (await realpath(directory) !== directory) return false;
    file = await open(join(directory, 'codex-context-policy-install.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 32000) return false;
    const buffer = Buffer.alloc(32001); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    signal.throwIfAborted();
    if (bytesRead > 32000) return false;
    const receipt = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)));
    const marker = ' # codex-context-policy-owner=' + createHash('sha256').update(root).digest('hex');
    return receipt?.version === 1 && receipt.source_root === await realpath(sourceRoot) &&
      Array.isArray(receipt.owned_groups) && receipt.owned_groups.some(entry => entry?.event === 'UserPromptSubmit' &&
        Array.isArray(entry.group?.hooks) && entry.group.hooks.some(handler => typeof handler.command === 'string' && handler.command.endsWith(marker)));
  } catch { return false; }
  finally { await file?.close().catch(() => {}); }
}

/** Read context policy on every call; missing, invalid, or external configuration is off. */
export async function readContextPolicyConfig(repoRoot, signal) {
  const disabled = { mode: 'off', jev_enabled: true, operations: {} };
  try {
    const root = await realpath(repoRoot);
    const configPath = await realpath(join(root, '.codex/codex-context-policy.json'));
    const pathInsideRoot = relative(root, configPath);
    if (pathInsideRoot.startsWith('..') || isAbsolute(pathInsideRoot)) return disabled;
    let file; let text; let revision;
    try {
      file = await open(configPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await file.stat();
      if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 32000) return disabled;
      text = await file.readFile({ encoding: 'utf8', signal });
      if (Buffer.byteLength(text) > 32000) return disabled;
      revision = createHash('sha256').update(JSON.stringify([stat.dev, stat.ino, stat.mtimeMs, stat.ctimeMs, stat.size])).digest('hex');
    } finally { await file?.close(); }
    const config = JSON.parse(text);
    if (!config || !contextModes.has(config.mode) || typeof config.jev_enabled !== 'boolean') return disabled;
    const operations = config.operations ?? {};
    if (typeof operations !== 'object' || operations === null || Array.isArray(operations) ||
        Object.values(operations).some(value => !contextModes.has(value))) return disabled;
    if (config.jev_model !== undefined && (typeof config.jev_model !== 'string' || !/^[A-Za-z0-9._:/-]{1,128}$/.test(config.jev_model))) return disabled;
    if (config.jev_actual_model !== undefined && (typeof config.jev_actual_model !== 'string' || !/^[A-Za-z0-9._:/-]{1,128}$/.test(config.jev_actual_model))) return disabled;
    return { mode: config.mode, jev_enabled: config.jev_enabled, operations,
      ...(config.mode === 'off' ? {} : { config_revision: revision }),
      ...(config.jev_actual_model === undefined ? {} : { jev_actual_model: config.jev_actual_model }),
      ...(config.jev_model === undefined ? {} : { jev_model: config.jev_model }) };
  } catch {
    return disabled;
  }
}

/** Handle a Codex hook without network, repository commands, or output while off. */
export async function handleCodexHook(input, sourceRoot) {
  const unchanged = { stdout: '', stderr: '', exit_code: 0 };
  if (!input || typeof input.cwd !== 'string' || typeof input.session_id !== 'string' ||
      typeof input.hook_event_name !== 'string') return unchanged;
  const signal = AbortSignal.timeout(2000);
  if (sourceRoot && !await ownsContextPolicyInstall(input.cwd, sourceRoot, signal)) return unchanged;
  const config = await readContextPolicyConfig(input.cwd, signal);
  if (config.mode === 'off') return unchanged;
  if (input.hook_event_name !== 'UserPromptSubmit' || typeof input.prompt !== 'string') return unchanged;
  let markInterrupted;
  try {
    const { readContextTask, captureContextTask, saveContextTask, resolveContextFacts,
      resolveContextDecision, recordContextDecision, markContextHistoryGap } = await import('./context-state.mjs');
    const { minimizeJevState, queryJevContext } = await import('./jev-client.mjs');
    const { readJevCredential } = await import('./context-credentials.mjs');
    const questions = JSON.parse(await readFile(new URL('../config/jev-questions.json', import.meta.url), 'utf8'));
    const stateDir = join(homedir(), '.codex/codex-context-policy');
    const previous = await readContextTask(stateDir, input.cwd, input.session_id);
    let state;
    markInterrupted = async () => {
      if ((!state && !previous) || input.is_subagent || input.parent_session_id) return;
      await markContextHistoryGap(stateDir, input.cwd, input.session_id);
    };
    const policySources = await Promise.all(['codex-context-policy.mjs', 'context-state.mjs', 'jev-client.mjs', 'context-credentials.mjs']
      .map(path => readFile(new URL(path, import.meta.url), 'utf8')));
    const versions = { client_version: typeof input.client_version === 'string' && /^\d+\.\d+\.\d+$/.test(input.client_version) ? input.client_version : 'unverified',
      jev_model: null, jev_requested_model: config.jev_model ?? null, config_revision: config.config_revision,
      questions_hash: createHash('sha256').update(JSON.stringify(questions)).digest('hex'),
      policy_hash: createHash('sha256').update(JSON.stringify({ config, sources: policySources })).digest('hex') };
    state = await captureContextTask({ ...input, signal, versions }, previous);
    if (previous && previous.versions.jev_requested_model !== versions.jev_requested_model) state.expected_jev_model = null;
    state.expected_jev_model = config.jev_actual_model ?? state.expected_jev_model;
    if (previous && previous.versions.config_revision !== versions.config_revision) {
      state.continuity = 'unknown'; state.history_gap = true;
    }
    const facts = resolveContextFacts(state);
    let decision = resolveContextDecision(state, facts, null);
    if (decision.action === 'baseline' && config.jev_enabled) {
      const minimized = minimizeJevState(state, facts);
      if (!minimized || !config.jev_model) decision.fallback_reason = !minimized ? (state.history_gap ? 'history-gap' : 'unsafe-request') : 'missing-model';
      else {
        let apiKey; let credentialUnavailable = false;
        try { apiKey = await readJevCredential(signal); }
        catch { signal.throwIfAborted(); credentialUnavailable = true; }
        const classified = await queryJevContext({ model: config.jev_model, state: minimized, questions },
          { apiKey, signal, mode: config.mode, jevEnabled: config.jev_enabled,
            expectedActualModel: config.jev_actual_model ?? state.expected_jev_model });
        decision = resolveContextDecision(state, facts, classified.response);
        decision.duration_ms = classified.duration_ms;
        decision.provider_attempts = classified.request_sent ? 1 : 0;
        if (classified.actual_model) decision.versions = { ...decision.versions, jev_model: classified.actual_model };
        if (classified.provider_usage) decision.provider_usage = classified.provider_usage;
        state.expected_jev_model ??= classified.response?.model ?? classified.actual_model ?? null;
        if (classified.status !== 'ok') decision.fallback_reason = credentialUnavailable ? 'credential-unavailable' : classified.fallback_reason;
        state.versions = decision.versions;
        if (classified.status === 'ok' && state.continuity === 'unknown' &&
            !['contradictory-classification', 'uncertain-classification', 'invalid-response'].includes(decision.fallback_reason)) {
          if (classified.response.answers.continues_active_goal.noul <= 0.10) {
            state.active_request = state.recent_requests.at(-1);
            state.context_epoch = randomUUID(); state.continuity = 'new';
          } else if (classified.response.answers.continues_active_goal.noul >= 0.90) state.continuity = 'known';
        }
      }
    }
    // Independent billing observations survive state conflicts and expired preparation.
    await recordContextDecision(stateDir, state, decision, signal);
    signal.throwIfAborted();
    if (!await saveContextTask(stateDir, state)) {
      await markInterrupted();
      return { ...unchanged, stderr: 'Context task state conflict; baseline retained.\n' };
    }
    signal.throwIfAborted();
  } catch (error) {
    await markInterrupted?.().catch(() => {});
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
      const result = await handleCodexHook(JSON.parse(text), await realpath(new URL('../', import.meta.url)));
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      process.exitCode = result.exit_code;
    } catch {
      process.stderr.write('Context hook input rejected; baseline retained.\n');
    }
  }
}
