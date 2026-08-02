#!/usr/bin/env node
import { TaliviaAgentClient } from './client.js';
import { readStoredConnection } from './config.js';
import { startMcpServer } from './mcp.js';
import { checkinAgent, setupAgent } from './setup.js';

const args = process.argv.slice(2);
const command = args[0] || 'mcp';
const options = parseOptions(args.slice(1));

try {
  if (command === 'setup') {
    const result = await setupAgent(options);
    print(
      `Open this URL to approve ${result.agent}:\n${result.loginUrl}\n\nVerification code: ${result.verificationCode}\n\n${result.next}`,
    );
  } else if (command === 'checkin') {
    const result = await checkinAgent(options);
    print(`${result.message}\nEndpoint: ${result.endpoint}`);
  } else if (command === 'mcp') {
    await startMcpServer();
  } else if (command === 'status') {
    const connection = readStoredConnection();
    if (!connection.apiKey) {
      print('Not connected. Run talivia setup --agent <name>.');
    } else {
      const client = new TaliviaAgentClient(connection);
      await client.request({ jsonrpc: '2.0', id: 'status', method: 'ping' });
      print(`Connected and verified at ${connection.endpoint}`);
    }
  } else {
    print(`Talivia AI Agent Kit

Revenue-first website analytics for founders, installed and verified by your AI agent.
Connect referrers, campaigns, pages, and visitor journeys to payment revenue.

Usage:
  talivia setup --agent <name> [--origin <url>] [--no-open]
  talivia checkin --agent <name>
  talivia status
  talivia mcp

Ask Codex, Claude Code, or another MCP client to create or select your Talivia website,
install the correct tracker, connect revenue through a secure browser handoff, and
verify that real analytics data is flowing.

Learn more: https://talivia.com/ai-agent-kit`);
  }
} catch (error) {
  process.stderr.write(`Talivia: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function parseOptions(values) {
  const options = {};

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (value === '--agent') options.agent = values[++index];
    else if (value === '--origin') options.origin = values[++index];
    else if (value === '--no-open') options.open = false;
  }

  return options;
}

function print(value) {
  process.stdout.write(`${value}\n`);
}
