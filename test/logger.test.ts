import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger.js';

function capture(level: Parameters<typeof createLogger>[0]) {
  const lines: string[] = [];
  return { logger: createLogger(level, (chunk) => lines.push(chunk)), lines };
}

describe('createLogger', () => {
  it('writes messages at or above the configured level', () => {
    const { logger, lines } = capture('warn');
    logger.error('e');
    logger.warn('w');
    logger.info('i');
    logger.debug('d');
    expect(lines).toEqual(['[worldmachine-mcp] error: e\n', '[worldmachine-mcp] warn: w\n']);
  });

  it('maps World Machine levels and drops licence lines', () => {
    const { logger, lines } = capture('debug');
    logger.worldMachine('warning', 'Shortcut shadows group');
    logger.worldMachine('error', 'clGetPlatformIDs (-1001)');
    logger.worldMachine('info', 'Startup: Basic initialization finished.');
    logger.worldMachine('info', 'License Manager.Checkout: License checkout successful (product wmpro)');
    expect(lines).toEqual([
      '[worldmachine-mcp] warn: wm: Shortcut shadows group\n',
      '[worldmachine-mcp] error: wm: clGetPlatformIDs (-1001)\n',
      '[worldmachine-mcp] info: wm: Startup: Basic initialization finished.\n',
    ]);
  });
});
