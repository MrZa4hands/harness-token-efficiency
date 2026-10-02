import { execFileSync } from 'node:child_process';

/** Resolve the primary checkout for the shared context installation lock from registered Git worktrees. */
export function resolveContextHooksRoot(root) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  let records;
  try {
    records = execFileSync('git', ['-C', root, 'worktree', 'list', '--porcelain', '-z'], {
      env, encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    }).split('\0');
  } catch {
    throw new Error('Context install cannot resolve registered Git worktrees');
  }
  if (!records.includes('worktree ' + root) || records.includes('bare') || !records[0].startsWith('worktree ')) {
    throw new Error('Context install requires a registered worktree with a primary checkout');
  }
  return records[0].slice('worktree '.length);
}
