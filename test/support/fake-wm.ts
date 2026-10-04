import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from '../../src/logger.js';

export const FAKE_WM = fileURLToPath(new URL('../fake-wm/fake-wm.mjs', import.meta.url));
export const FIXTURES = fileURLToPath(new URL('../fixtures/wm-4067', import.meta.url));

export function fakeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, FAKE_WM_FIXTURES: FIXTURES, ...extra };
}

export function recorder(): { path: string; lines(): string[] } {
  const path = join(mkdtempSync(join(tmpdir(), 'fake-wm-')), 'record.txt');
  return {
    path,
    lines: () => {
      try {
        return readFileSync(path, 'utf8')
          .split('\n')
          .filter((line) => line !== '');
      } catch {
        return [];
      }
    },
  };
}

export function captureLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const push = (level: string) => (message: string) => {
    lines.push(`${level}: ${message}`);
  };
  return {
    lines,
    error: push('error'),
    warn: push('warn'),
    info: push('info'),
    debug: push('debug'),
    worldMachine: (level, text) => lines.push(`wm-${level}: ${text}`),
  };
}

export async function waitUntil(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitUntil timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
