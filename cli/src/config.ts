import fs from 'fs-extra';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.procurement-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface CliConfig {
  baseUrl: string;
  agentId?: string;
  apiKey?: string;
  role?: string;
  defaultPageSize?: number;
}

const defaultConfig: CliConfig = {
  baseUrl: process.env.PROCUREMENT_BASE_URL || 'http://localhost:5000',
  defaultPageSize: 20,
};

export async function loadConfig(): Promise<CliConfig> {
  try {
    if (await fs.pathExists(CONFIG_FILE)) {
      const saved = await fs.readJson(CONFIG_FILE);
      return { ...defaultConfig, ...saved };
    }
  } catch {
    // ignore
  }
  return { ...defaultConfig };
}

export async function saveConfig(config: Partial<CliConfig>): Promise<void> {
  await fs.ensureDir(CONFIG_DIR);
  const current = await loadConfig();
  await fs.writeJson(CONFIG_FILE, { ...current, ...config }, { spaces: 2 });
}

export async function clearConfig(): Promise<void> {
  if (await fs.pathExists(CONFIG_FILE)) {
    await fs.remove(CONFIG_FILE);
  }
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}
