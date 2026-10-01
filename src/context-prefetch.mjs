import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { selectCodeContext, getRepositoryChanges, readContext } from './repository-context.mjs';
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
  const latestRequest = state.recent_requests.at(-1)?.text ?? state.active_request?.text ?? '';
  if (decision.operation === 'code_review_context' &&
      (!/^(?:please\s+)?(?:review|revisa|revisar)\s+(?:all\s+(?:the\s+)?changes|(?:the\s+)?(?:whole|entire)\s+(?:worktree|working\s+tree)|todos\s+los\s+cambios)(?:\s+and\s+(?:inspect|read|examine)\s+.+)?[.!?]?\s*$/iu.test(latestRequest.trim()) ||
      /\b(?:only|solo|solamente|range|rango|staged|unstaged|cached|index|commit(?:s|ted)?|merged|HEAD|branch|rama|against|vs|versus|contra|since|desde|PR|pull\s+request|diff)\b|\.\.|[~^]|\b[a-f0-9]{7,64}\b/iu.test(requests))) return null;
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
    if (decision.operation === 'code_review_context') {
      const changes = await getRepositoryChanges({ ...request, byte_limit: byteLimit });
      operations.push({ operation: 'get_repository_changes', bundle: changes });
      // Walk every inventory page without expanding oversized hunks; incomplete changed paths must abstain.
      let page = changes;
      for (;;) {
        if (page.status !== 'ok') return null;
        for (const entry of [...page.entries, ...page.omissions]) {
          if (!state.inventory.includes(entry.path)) return null;
          if (!paths.includes(entry.path)) paths.push(entry.path);
        }
        if (!page.next_cursor) break;
        page = await readContext({ ...request, reference: changes.full_result, cursor: page.next_cursor, byte_limit: byteLimit });
      }
    }
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
