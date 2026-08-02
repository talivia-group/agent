import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG_FILENAME = 'config.json';

export function getConfigDir() {
  return process.env.TALIVIA_CONFIG_HOME || path.join(os.homedir(), '.talivia');
}

export function getConfigPath() {
  return path.join(getConfigDir(), CONFIG_FILENAME);
}

export function readConfig() {
  const filePath = getConfigPath();

  if (!existsSync(filePath)) return {};

  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

export function readStoredConnection() {
  const config = readConfig();

  return {
    apiKey: process.env.TALIVIA_API_KEY || config.apiKey,
    endpoint: config.endpoint || 'https://talivia.com/mcp',
    expiresAt: config.expiresAt,
  };
}

export function saveConnection({ apiKey, endpoint, expiresAt }) {
  const config = readConfig();
  writeConfig({ ...config, apiKey, endpoint, expiresAt, updatedAt: new Date().toISOString() });
}

export function savePendingSetup({
  agent,
  sessionId,
  checkinToken,
  loginUrl,
  expiresAt,
  apiBaseUrl,
}) {
  const config = readConfig();
  const setups = {
    ...(config.setups || {}),
    [agent]: {
      agent,
      sessionId,
      checkinToken,
      loginUrl,
      expiresAt,
      apiBaseUrl,
      createdAt: new Date().toISOString(),
    },
  };
  writeConfig({ ...config, setups, updatedAt: new Date().toISOString() });
}

export function readPendingSetup(agent) {
  return readConfig().setups?.[agent];
}

export function clearPendingSetup(agent) {
  const config = readConfig();

  if (!config.setups?.[agent]) return;

  const setups = { ...config.setups };
  delete setups[agent];
  writeConfig({ ...config, setups, updatedAt: new Date().toISOString() });
}

function writeConfig(config) {
  const directory = getConfigDir();
  const filePath = getConfigPath();

  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

  try {
    chmodSync(directory, 0o700);
    chmodSync(filePath, 0o600);
  } catch {
    // Windows and a few filesystems do not support POSIX modes.
  }
}
