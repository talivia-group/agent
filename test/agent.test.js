import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { TaliviaAgentClient } from '../src/client.js';
import { readStoredConnection, saveConnection } from '../src/config.js';

test('stores local credentials with private directory and file modes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'talivia-agent-test-'));
  const previous = process.env.TALIVIA_CONFIG_HOME;
  process.env.TALIVIA_CONFIG_HOME = directory;

  try {
    saveConnection({
      apiKey: 'test-key',
      endpoint: 'https://talivia.com/mcp',
      expiresAt: '2026-10-01T00:00:00.000Z',
    });
    const connection = readStoredConnection();
    const directoryMode = (await stat(directory)).mode & 0o777;
    const fileMode = (await stat(path.join(directory, 'config.json'))).mode & 0o777;

    assert.equal(connection.apiKey, 'test-key');
    assert.equal(directoryMode, 0o700);
    assert.equal(fileMode, 0o600);
  } finally {
    if (previous === undefined) delete process.env.TALIVIA_CONFIG_HOME;
    else process.env.TALIVIA_CONFIG_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test('HTTP client advertises JSON and event-stream and parses SSE responses', async () => {
  const originalFetch = globalThis.fetch;
  let accept = '';

  globalThis.fetch = async (_url, options) => {
    accept = options.headers.Accept;
    return new Response('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
  };

  try {
    const client = new TaliviaAgentClient({ endpoint: 'https://talivia.com/mcp', apiKey: 'key' });
    const response = await client.request({ jsonrpc: '2.0', id: 1, method: 'ping' });

    assert.equal(accept, 'application/json, text/event-stream');
    assert.deepEqual(response.result, { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SSE parsing forwards server notifications and returns the matching response', async () => {
  const originalFetch = globalThis.fetch;
  const forwarded = [];

  globalThis.fetch = async () =>
    new Response(
      [
        'event: message',
        'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}',
        '',
        'event: message',
        'data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}',
        '',
      ].join('\n'),
      { headers: { 'content-type': 'text/event-stream' } },
    );

  try {
    const client = new TaliviaAgentClient({ endpoint: 'https://talivia.com/mcp', apiKey: 'key' });
    const response = await client.request(
      { jsonrpc: '2.0', id: 7, method: 'ping' },
      { onMessage: message => forwarded.push(message) },
    );

    assert.equal(forwarded[0].method, 'notifications/progress');
    assert.deepEqual(response.result, { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('registry-style no-argument launch starts stdio MCP and exits quietly at EOF', async () => {
  const result = await runCli([], '');

  assert.equal(result.code, 0);
  assert.equal(result.stdout, '');
});

test('failed notifications never emit a JSON-RPC response', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'talivia-agent-notification-test-'));
  await writeFile(
    path.join(directory, 'config.json'),
    `${JSON.stringify({ apiKey: 'invalid', endpoint: 'http://127.0.0.1:1/mcp' })}\n`,
  );

  try {
    const result = await runCli(
      ['mcp'],
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
      { TALIVIA_CONFIG_HOME: directory },
    );

    assert.equal(result.code, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /notification failed/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('valid JSON with an invalid JSON-RPC shape returns Invalid Request', async () => {
  const result = await runCli(['mcp'], '{}\n[]\n');
  const responses = result.stdout
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));

  assert.equal(result.code, 0);
  assert.equal(responses.length, 2);
  assert.deepEqual(
    responses.map(response => response.error.code),
    [-32600, -32600],
  );
  assert.deepEqual(
    responses.map(response => response.id),
    [null, null],
  );
});

function runCli(args, input, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/cli.js', ...args], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, ...environment },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}
