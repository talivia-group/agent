import readline from 'node:readline';
import { TaliviaAgentClient } from './client.js';

export async function startMcpServer(options = {}) {
  const client = new TaliviaAgentClient(options);
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of input) {
    if (!line.trim()) continue;

    let message;

    try {
      message = JSON.parse(line);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }

    const isObject = message !== null && typeof message === 'object' && !Array.isArray(message);
    const isNotification =
      isObject &&
      message.jsonrpc === '2.0' &&
      typeof message.method === 'string' &&
      !Object.hasOwn(message, 'id');

    if (!isObject || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      write({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
      continue;
    }

    try {
      const response = await client.request(message, { onMessage: write });
      if (response) write(response);
    } catch (error) {
      if (isNotification) {
        process.stderr.write(
          `Talivia MCP notification failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
        );
        continue;
      }
      write({
        jsonrpc: '2.0',
        id: message?.id ?? null,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Talivia MCP bridge failed.',
        },
      });
    }
  }
}

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
