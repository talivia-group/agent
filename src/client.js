import { readStoredConnection } from './config.js';
import { TaliviaAgentError } from './setup.js';

export class TaliviaAgentClient {
  constructor(options = {}) {
    const stored = readStoredConnection();
    this.endpoint = options.endpoint || stored.endpoint;
    this.apiKey = options.apiKey || stored.apiKey;
  }

  async request(message, options = {}) {
    if (!this.apiKey) {
      throw new TaliviaAgentError(
        'NOT_CONNECTED',
        'Run talivia setup --agent <name> and talivia checkin --agent <name> first.',
      );
    }

    let response;

    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-11-25',
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new TaliviaAgentError('TIMEOUT', 'Talivia MCP request timed out.');
      }
      throw new TaliviaAgentError('NETWORK_ERROR', 'Unable to reach the Talivia MCP endpoint.');
    }

    if (response.status === 202) return null;

    const text = await response.text();
    let data;

    try {
      data = text
        ? response.headers.get('content-type')?.includes('text/event-stream')
          ? parseEventStream(
              text,
              Object.hasOwn(message || {}, 'id') ? message.id : undefined,
              options.onMessage,
            )
          : JSON.parse(text)
        : null;
    } catch {
      throw new TaliviaAgentError('INVALID_RESPONSE', 'Talivia MCP returned invalid JSON.');
    }

    if (!response.ok) {
      throw new TaliviaAgentError(
        data?.error?.code || `HTTP_${response.status}`,
        data?.error?.message || response.statusText || 'Talivia MCP request failed.',
        data,
      );
    }

    return data;
  }
}

function parseEventStream(text, requestId, onMessage) {
  for (const event of text.split(/\r?\n\r?\n/)) {
    const payload = event
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n');

    if (!payload || payload === '[DONE]') continue;

    const message = JSON.parse(payload);

    if (requestId !== undefined && Object.hasOwn(message || {}, 'id') && message.id === requestId) {
      return message;
    }

    onMessage?.(message);
  }

  if (requestId === undefined) return null;

  throw new Error('No matching JSON-RPC response was returned.');
}
