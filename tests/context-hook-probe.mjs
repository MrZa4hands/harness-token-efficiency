// Temporary compatibility probe; never imported by the production policy.
import { realpath, lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

try {
  const root = await realpath(process.argv[2]);
  const marker = process.argv[3];
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(marker)) throw new Error('Context probe marker invalid');
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    text += chunk;
    if (Buffer.byteLength(text) > 1_000_000) throw new Error('Context probe input too large');
  }
  const input = JSON.parse(text);
  if (await realpath(input.cwd) !== root) throw new Error('Context probe cwd mismatch');
  const events = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostCompact', 'SessionStart', 'SessionEnd'];
  if (!events.includes(input.hook_event_name) || typeof input.session_id !== 'string') throw new Error('Context probe event invalid');
  const directory = join(root, '.codex');
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Context probe directory invalid');
  const hashIdentity = value => createHash('sha256').update(value).digest('hex');
  const record = {
    hook_event_name: input.hook_event_name,
    session_hash: hashIdentity(input.session_id),
    turn_hash: typeof input.turn_id === 'string' ? hashIdentity(input.turn_id) : null,
    observed_at: new Date().toISOString(),
  };
  const log = await open(join(directory, 'context-hook-probe.jsonl'), constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    await log.writeFile(JSON.stringify(record) + '\n');
  } finally {
    await log.close();
  }
  if (input.hook_event_name === 'UserPromptSubmit') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit', additionalContext: 'Compatibility probe marker: ' + marker,
    } }));
  }
} catch {
  process.stderr.write('Context compatibility probe rejected; baseline retained.\n');
}
