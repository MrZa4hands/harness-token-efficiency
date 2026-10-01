import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { selectCodeContext, getRepositoryChanges } from './repository-context.mjs';
import { resolveContextFacts } from './context-state.mjs';

/** Prepare exact Codex context within the caller's shared deadline; incomplete proposals abstain.
 * @param {import('./context-state.mjs').TaskState} state
 * @param {{action:string,operation:string,source:string,versions:object,fallback_reason:string|null}} decision
 * @param {object} versions
 * @param {{state_dir?:string,signal?:AbortSignal}} [options]
 * @returns {Promise<object|null>} */
export async function prepareCodexContext(state, decision, versions, options = {}) {
  if (decision.action !== 'prefetch' || !['code_context', 'code_review_context', 'documentation_context'].includes(decision.operation) ||
      state.history_gap || JSON.stringify(state.versions) !== JSON.stringify(versions) ||
      ['contradictory-classification', 'invalid-response', 'uncertain-classification'].includes(decision.fallback_reason)) return null;
  // ponytail: automatic review covers the whole worktree; scoped reviews abstain until scope parsing is verified.
  const requests = [state.active_request?.text, ...state.recent_requests.map(request => request.text)].join('\n');
  if (decision.operation === 'code_review_context' && /\b(?:only|solo|solamente|range|rango)\b|\.\./iu.test(requests)) return null;
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(2000)]) : AbortSignal.timeout(2000);
  try {
    signal.throwIfAborted(); const facts = resolveContextFacts(state);
    const paths = [...facts.explicit_paths];
    if (decision.operation === 'documentation_context' && !paths.length)
      paths.push(...state.inventory.filter(path => basename(path).toLowerCase() === 'readme.md' || path.startsWith('docs/') && /\.md$/i.test(path)));
    if (decision.operation === 'code_context' && !paths.length && !facts.literal_symbols.length) return null;
    const request = { repo_root: state.repo_root, state_dir: options.state_dir ?? join(homedir(), '.codex/codex-context-policy'),
      session_id: state.session_id, request_hash: state.request_hash, repo_revision: state.repo_revision,
      context_epoch: state.context_epoch, scope: { kind: 'worktree' }, signal };
    const operations = [];
    const byteLimit = decision.operation === 'code_review_context' ? 2200 : 4200;
    if (decision.operation === 'code_review_context') operations.push({ operation: 'get_repository_changes',
      bundle: await getRepositoryChanges({ ...request, byte_limit: byteLimit }) });
    signal.throwIfAborted();
    operations.push({ operation: 'select_code_context', bundle: await selectCodeContext({ ...request,
      paths, symbols: facts.literal_symbols, family: decision.operation, exhaustive: facts.exhaustive, byte_limit: byteLimit }) });
    if (operations.some(({ bundle }) => bundle.status !== 'ok')) return null;
    signal.throwIfAborted();
    const bundle = { status: 'ok', entries: operations.flatMap(({ operation, bundle }) => bundle.entries.map(entry => ({ ...entry, operation }))),
      coverage_status: 'partial', omissions: operations.flatMap(({ operation, bundle }) => bundle.omissions.map(item => ({
        ...item, operation, reference: bundle.full_result }))),
      omitted_count: operations.reduce((count, { bundle }) => count + bundle.omitted_count, 0),
      next_cursor: null, full_result: null, exit_code: 0, stderr: '',
      continuations: operations.map(({ operation, bundle }) => ({ operation, reference: bundle.full_result, next_cursor: bundle.next_cursor })),
      provenance: { source: 'codex-context-policy', representation: 'evidence-data', repo_root: state.repo_root,
        session_id: state.session_id, request_hash: state.request_hash, repo_revision: state.repo_revision,
        context_epoch: state.context_epoch, versions } };
    const bytes = Buffer.byteLength(JSON.stringify(bundle));
    // ponytail: ceil(UTF-8 bytes / 3) is an approximate token budget; actual client usage decides promotion.
    if (bytes > 6000 || Math.ceil(bytes / 3) > 2000) return null;
    signal.throwIfAborted(); return bundle;
  } catch { return null; }
}
