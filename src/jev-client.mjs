import { realpath, lstat, mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveContextHooksRoot } from './context-install-lock.mjs';

const jevLabels = ['code_context', 'code_review_context', 'documentation_context', 'baseline'];
const jevQuestionNames = ['continues_active_goal', 'needs_repository_context', 'needs_change_context',
  'needs_documentation_context', 'requires_exhaustive_coverage', 'context_operation'];
const jevModelValid = value => typeof value === 'string' && /^[A-Za-z0-9._:/-]{1,128}$/.test(value);
const jevProbabilityValid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const jevCountValid = value => Number.isSafeInteger(value) && value >= 0;
function jevExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function jevRequestTextSafe(text) {
  return typeof text === 'string' && text.trim().length > 0 && Buffer.byteLength(text) <= 1600 &&
    !/[\u0000-\u001f\u007f]|```|-----BEGIN|github_pat_|gh[pousr]_|\bsk-[A-Za-z0-9]|\bAKIA[A-Z0-9]|\bBearer\b|\b(?:[A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD))\s*[:=]|[a-z][a-z0-9+.-]*:\/\/[^/\s]+@|\b(?:export|import|def|function|class)\s+|=>/iu.test(text) &&
    !/\b(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=|\b(?:select\b.+\bfrom|insert\s+into|update\b.+\bset|delete\s+from|create\s+table|drop\s+table)\b/iu.test(text) &&
    !/\b(?:password|passphrase|pin|contraseña|clave|token|secret|key|credential|secreto|credencial)\s+(?:is|es)\s+\S+/iu.test(text) &&
    !text.replace(/`[\p{L}\p{N}_$./:-]+`/gu, '').includes('`') &&
    !/[A-Za-z0-9+/_=-]{32,}/.test(text);
}
function jevMinimalStateValid(state) {
  return jevExactKeys(state, ['request', 'active_goal', 'continuity', 'facts']) && jevRequestTextSafe(state.request) &&
    (state.active_goal === null || jevRequestTextSafe(state.active_goal)) && ['new', 'known', 'unknown'].includes(state.continuity) &&
    jevExactKeys(state.facts, ['explicit_path_count', 'literal_symbol_count', 'exhaustive', 'change_scope']) &&
    jevCountValid(state.facts.explicit_path_count) && jevCountValid(state.facts.literal_symbol_count) &&
    typeof state.facts.exhaustive === 'boolean' && [null, 'worktree'].includes(state.facts.change_scope);
}
function jevQuestionsValid(questions) {
  if (!jevExactKeys(questions, jevQuestionNames)) return false;
  return Object.entries(questions).every(([name, question]) => {
    if (!jevQuestionNames.includes(name) || !question || typeof question.instructions !== 'string' || !question.instructions.trim()) return false;
    if (name === 'context_operation') return jevExactKeys(question, ['type', 'instructions', 'criteria']) &&
      question.type === 'choice' && jevExactKeys(question.criteria, jevLabels) &&
      Object.values(question.criteria).every(value => typeof value === 'string');
    return jevExactKeys(question, ['type', 'instructions']) && question.type === 'noul';
  });
}

/** Minimize Jev context to bounded explicit requests and safe facts, never code or transcripts. */
export function minimizeJevState(state, facts) {
  if (state.history_gap) return null;
  const request = state.recent_requests.at(-1)?.text;
  const activeGoal = state.active_request?.text;
  const minimized = { request, active_goal: activeGoal && activeGoal !== request ? activeGoal : null,
    continuity: state.continuity, facts: { explicit_path_count: facts.explicit_paths.length,
      literal_symbol_count: facts.literal_symbols.length, exhaustive: facts.exhaustive,
      change_scope: facts.change_scope?.kind ?? null } };
  return jevMinimalStateValid(minimized) ? minimized : null;
}

/** Validate named Jev context answers, actual model, distributions, and billable usage. */
export function validateJevContextResponse(response, questions) {
  if (!jevQuestionsValid(questions) || !jevExactKeys(response, ['model', 'answers', 'usage']) || !jevModelValid(response.model) ||
      !jevExactKeys(response.answers, Object.keys(questions)) || !jevExactKeys(response.usage, ['input_tokens', 'output_tokens']) ||
      !Object.values(response.usage).every(jevCountValid)) return false;
  return Object.entries(questions).every(([name, question]) => {
    const answer = response.answers[name];
    if (question.type === 'noul') return jevExactKeys(answer, ['type', 'noul']) && answer.type === 'noul' && jevProbabilityValid(answer.noul);
    if (!jevExactKeys(answer, ['type', 'choice', 'confidence', 'probabilities']) || answer.type !== 'choice' ||
        !jevLabels.includes(answer.choice) || !jevProbabilityValid(answer.confidence) ||
        !jevExactKeys(answer.probabilities, jevLabels) || !Object.values(answer.probabilities).every(jevProbabilityValid)) return false;
    const probabilities = Object.values(answer.probabilities);
    return Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) <= 1e-6 &&
      answer.probabilities[answer.choice] === Math.max(...probabilities);
  });
}

async function fetchJevJson(url, init, options, timeoutMs) {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(new Error('Jev deadline exceeded')), timeoutMs);
  let reader; let abortListener;
  try {
    signal.throwIfAborted();
    const operation = (async () => {
      const response = await (options.fetchImpl ?? fetch)(url, { ...init, redirect: 'error', signal,
        headers: { Authorization: 'Bearer ' + options.apiKey, 'Content-Type': 'application/json' } });
      signal.throwIfAborted();
      if (!response.ok) { await response.body?.cancel(); return { error: 'http-' + response.status }; }
      if (!response.body) return { error: 'invalid-response' };
      reader = response.body.getReader(); const chunks = []; let bytes = 0;
      while (true) {
        signal.throwIfAborted(); const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 32000) return { error: 'response-too-large' };
        chunks.push(Buffer.from(chunk.value));
      }
      signal.throwIfAborted();
      try { return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }; }
      catch { return { error: 'invalid-response' }; }
    })();
    const interrupted = new Promise((resolve, reject) => {
      abortListener = () => reject(signal.reason);
      signal.addEventListener('abort', abortListener, { once: true });
      if (signal.aborted) abortListener();
    });
    return await Promise.race([operation, interrupted]);
  } catch { return { error: signal.aborted ? 'timeout' : 'network-error' }; }
  finally {
    clearTimeout(timer); signal.removeEventListener('abort', abortListener);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}

/** Query Jev context once with a one-second deadline and no retries or redirects. */
export async function queryJevContext(request, options = {}) {
  const started = performance.now();
  let requestSent = false;
  const abstain = reason => ({ status: 'abstain', response: null, fallback_reason: reason, duration_ms: performance.now() - started, request_sent: requestSent });
  if (options.mode === 'off' || options.jevEnabled === false || options.conclusiveRule) return abstain('ineligible');
  if (typeof options.apiKey !== 'string' || !options.apiKey.trim()) return abstain('missing-credential');
  if (!jevExactKeys(request, ['model', 'state', 'questions']) || !jevModelValid(request.model) ||
      !jevMinimalStateValid(request.state) || !jevQuestionsValid(request.questions)) return abstain('unsafe-request');
  let body; try { body = JSON.stringify(request); } catch { return abstain('unsafe-request'); }
  if (Buffer.byteLength(body) > 6000) return abstain('request-too-large');
  if (options.signal?.aborted) return abstain('timeout');
  requestSent = true;
  const result = await fetchJevJson('https://api.typesafe.ai/v1/systemone', { method: 'POST', body }, options, 1000);
  if (result.error) return abstain(result.error);
  if (!validateJevContextResponse(result.value, request.questions)) {
    const billingValid = jevModelValid(result.value?.model) && jevExactKeys(result.value?.usage, ['input_tokens', 'output_tokens']) &&
      Object.values(result.value.usage).every(jevCountValid);
    return { ...abstain('invalid-response'), ...(billingValid ? { actual_model: result.value.model, provider_usage: result.value.usage } : {}) };
  }
  if (options.expectedActualModel && result.value.model !== options.expectedActualModel) return {
    ...abstain('changed-actual-model'), actual_model: result.value.model, provider_usage: result.value.usage };
  return { status: 'ok', response: result.value, fallback_reason: null, duration_ms: performance.now() - started, request_sent: true };
}

/** Discover Jev model names during setup, never inside the context hook critical path. */
export async function discoverJevModels(options = {}) {
  const abstain = reason => ({ status: 'abstain', models: [], fallback_reason: reason });
  if (typeof options.apiKey !== 'string' || !options.apiKey.trim()) return abstain('missing-credential');
  const result = await fetchJevJson('https://api.typesafe.ai/v1/models', { method: 'GET' }, options, 5000);
  if (result.error) return abstain(result.error);
  if (!jevExactKeys(result.value, ['models']) || !Array.isArray(result.value.models) || !result.value.models.length ||
      !result.value.models.every(model => jevExactKeys(model, ['name', 'description', 'release_date']) &&
        jevModelValid(model.name) && typeof model.description === 'string' && typeof model.release_date === 'string' &&
        /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(model.release_date) &&
        Number.isFinite(Date.parse(model.release_date))) ||
      new Set(result.value.models.map(model => model.name)).size !== result.value.models.length) return abstain('invalid-response');
  return { status: 'ok', models: result.value.models, fallback_reason: null };
}

/** Configure a discovered Jev model privately while preserving the current policy mode. */
export async function configureJevModel(repoRoot, options = {}) {
  const abstain = reason => ({ status: 'abstain', model: null, fallback_reason: reason });
  const discovered = await discoverJevModels(options);
  if (discovered.status !== 'ok') return abstain(discovered.fallback_reason);
  const model = options.model ?? discovered.models[0].name;
  if (!discovered.models.some(candidate => candidate.name === model)) return abstain('undiscovered-model');
  let lock; let temporary; let lockPath;
  try {
    const root = await realpath(repoRoot); const directory = join(root, '.codex');
    await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || await realpath(directory) !== directory) return abstain('unsafe-configuration');
    const metadata = await lstat(join(root, '.git')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (metadata?.isSymbolicLink()) return abstain('unsafe-configuration');
    const hooksRoot = metadata?.isFile() ? await realpath(resolveContextHooksRoot(root)) : root;
    const hooksDirectory = join(hooksRoot, '.codex');
    await mkdir(hooksDirectory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const hooksStat = await lstat(hooksDirectory);
    if (!hooksStat.isDirectory() || hooksStat.isSymbolicLink() || await realpath(hooksDirectory) !== hooksDirectory) return abstain('unsafe-configuration');
    lockPath = join(hooksDirectory, '.codex-context-policy-install.lock');
    try { lock = await open(lockPath, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') return abstain('configuration-conflict'); throw error; }
    const path = join(directory, 'codex-context-policy.json');
    const stat = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32000)) return abstain('unsafe-configuration');
    const previousText = stat ? await readFile(path, 'utf8') : null;
    const config = previousText ? JSON.parse(previousText) : { mode: 'off', jev_enabled: true };
    if (!config || !['off', 'shadow', 'enforce'].includes(config.mode) || typeof config.jev_enabled !== 'boolean' ||
        (config.operations !== undefined && (!config.operations || typeof config.operations !== 'object' || Array.isArray(config.operations) ||
          Object.values(config.operations).some(value => !['off', 'shadow', 'enforce'].includes(value))))) return abstain('invalid-configuration');
    if (config.jev_model !== model) delete config.jev_actual_model;
    const policyText = JSON.stringify({ ...config, jev_model: model }, null, 2) + '\n';
    if (Buffer.byteLength(policyText) > 32000) return abstain('unsafe-configuration');
    const temporaryPath = join(directory, '.jev-setup-' + randomUUID() + '.tmp');
    const file = await open(temporaryPath, 'wx', 0o600); temporary = temporaryPath;
    try { await file.writeFile(policyText); await file.sync(); }
    finally { await file.close(); }
    const current = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if ((current && (!current.isFile() || current.isSymbolicLink())) ||
        (current ? await readFile(path, 'utf8') : null) !== previousText) return abstain('configuration-conflict');
    await rename(temporary, path); temporary = null;
    return { status: 'ok', model, fallback_reason: null };
  } catch { return abstain('configuration-rejected'); }
  finally {
    try { if (temporary) await unlink(temporary); }
    finally { if (lock) { try { await lock.close(); } finally { await unlink(lockPath); } } }
  }
}
