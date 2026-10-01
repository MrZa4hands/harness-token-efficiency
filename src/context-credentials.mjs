import { execFile, spawn } from 'node:child_process';

const jevCredentialAccount = 'codex-token-efficiency';
const jevCredentialService = 'codex-token-efficiency.typesafe-api-key';
function validateJevCredential(value) {
  const key = value.trim();
  if (!key || key.length > 4096 || /[^\x21-\x7e]/.test(key)) throw new Error('Context Jev credential rejected; baseline retained.');
  return key;
}

/** Read Jev credentials from the environment or native Keychain without exporting their contents. */
export async function readJevCredential(signal, preferEnvironment = true) {
  if (preferEnvironment && process.env.TYPESAFE_API_KEY?.trim()) return validateJevCredential(process.env.TYPESAFE_API_KEY);
  if (process.platform !== 'darwin') return null;
  let text;
  try {
    text = await new Promise((resolve, reject) => {
      execFile('/usr/bin/security', ['find-generic-password', '-a', jevCredentialAccount, '-s', jevCredentialService, '-w'],
        { encoding: 'utf8', maxBuffer: 8192, timeout: 500, signal }, (error, stdout) => error ? reject(error) : resolve(stdout));
    });
  } catch (error) {
    if (error.code === 44) return null;
    throw new Error('Context Jev credential lookup failed; baseline retained.');
  }
  return validateJevCredential(text);
}

/** Configure Jev credentials through a native hidden prompt, never through argv or hook JSON. */
export async function configureJevCredential() {
  if (process.platform !== 'darwin') throw new Error('Context Jev credential setup requires macOS; use TYPESAFE_API_KEY on other platforms.');
  if (!process.stdin.isTTY) throw new Error('Context Jev credential setup requires an interactive terminal.');
  await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/security', ['add-generic-password', '-U', '-a', jevCredentialAccount,
      '-s', jevCredentialService, '-w'], { stdio: ['inherit', 'ignore', 'inherit'] });
    child.on('error', () => reject(new Error('Context Jev credential setup failed; no credential was exported.')));
    child.on('close', code => code === 0 ? resolve() : reject(new Error('Context Jev credential setup failed; no credential was exported.')));
  });
  const key = await readJevCredential(undefined, false);
  if (!key) throw new Error('Context Jev credential lookup failed after native setup.');
  return key;
}
