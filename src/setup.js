import { spawn } from 'node:child_process';
import { clearPendingSetup, readPendingSetup, saveConnection, savePendingSetup } from './config.js';

const DEFAULT_ORIGIN = 'https://talivia.com';

export function normalizeAgentName(value = 'local-agent') {
  const normalized = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40);

  return normalized || 'local-agent';
}

export async function setupAgent(options = {}) {
  const agent = normalizeAgentName(options.agent);
  const apiBaseUrl = normalizeOrigin(options.origin || DEFAULT_ORIGIN);
  const setup = await request(`${apiBaseUrl}/api/agent/setup/start`, {
    agentName: agent,
  });

  savePendingSetup({ ...setup, agent, apiBaseUrl });

  if (options.open !== false) openBrowser(setup.loginUrl);

  return {
    agent,
    loginUrl: setup.loginUrl,
    verificationCode: setup.verificationCode,
    expiresAt: setup.expiresAt,
    next: `Approve in the browser, then run: npx -y @talivia/agent checkin --agent ${agent}`,
  };
}

export async function checkinAgent(options = {}) {
  const agent = normalizeAgentName(options.agent);
  const pending = readPendingSetup(agent);

  if (!pending?.checkinToken || !pending?.sessionId) {
    throw new TaliviaAgentError(
      'SETUP_SESSION_MISSING',
      `Run talivia setup --agent ${agent} before checkin.`,
    );
  }

  const result = await request(`${pending.apiBaseUrl}/api/agent/setup/checkin`, {
    sessionId: pending.sessionId,
    checkinToken: pending.checkinToken,
  });
  saveConnection({ apiKey: result.key, endpoint: result.endpoint, expiresAt: result.expiresAt });
  clearPendingSetup(agent);

  return {
    connected: true,
    agent: result.agentName || agent,
    endpoint: result.endpoint,
    message: 'Talivia is connected. The credential was saved with mode 0600.',
  };
}

async function request(url, body) {
  let response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new TaliviaAgentError('TIMEOUT', 'Talivia setup timed out. Try again.');
    }
    throw new TaliviaAgentError(
      'NETWORK_ERROR',
      'Unable to reach Talivia. Check the URL and network.',
    );
  }
  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new TaliviaAgentError('INVALID_RESPONSE', 'Talivia returned an invalid JSON response.');
  }

  if (!response.ok) {
    const error = data?.error || {};
    throw new TaliviaAgentError(
      error.code || `HTTP_${response.status}`,
      error.message || response.statusText || 'Talivia setup failed.',
      data,
    );
  }

  return data;
}

function normalizeOrigin(value) {
  const url = new URL(value);
  url.search = '';
  url.hash = '';

  return url.toString().replace(/\/$/, '');
}

function openBrowser(url) {
  const commands = {
    darwin: ['open', [url]],
    win32: ['cmd', ['/c', 'start', '', url]],
  };
  const [command, args] = commands[process.platform] || ['xdg-open', [url]];

  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The login URL is always printed, so opening the browser is best effort.
  }
}

export class TaliviaAgentError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = 'TaliviaAgentError';
    this.code = code;
    this.data = data;
  }
}
