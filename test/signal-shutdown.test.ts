import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignalShutdown } from '../src/signal-shutdown.js';
import { captureLogger } from './support/fake-wm.js';

const never = () => new Promise<void>(() => undefined);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(stop: () => Promise<void>, kill: () => Promise<void>) {
  const exit = vi.fn<(code: number) => void>();
  const logger = captureLogger();
  const shutdown = createSignalShutdown({ stop, kill, exit, logger, boundMs: 1_000 });
  return { shutdown, exit, logger };
}

describe('createSignalShutdown', () => {
  it('exits 0 once after a single trigger whose stop settles', async () => {
    const stop = vi.fn(() => Promise.resolve());
    const { shutdown, exit } = setup(stop, never);
    shutdown.trigger('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    expect(stop).toHaveBeenCalledWith('SIGTERM');
    expect(exit.mock.calls).toEqual([[0]]);
  });

  it('exits 0 after a failed stop and logs it', async () => {
    const { shutdown, exit, logger } = setup(() => Promise.reject(new Error('boom')), never);
    shutdown.trigger('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    expect(exit.mock.calls).toEqual([[0]]);
    expect(logger.lines.some((line) => line.includes('Shutdown failed'))).toBe(true);
  });

  it('exits 1 after boundMs when a repeated trigger finds kill never settling', async () => {
    const { shutdown, exit } = setup(never, never);
    shutdown.trigger('SIGTERM');
    shutdown.trigger('SIGTERM');
    await vi.advanceTimersByTimeAsync(999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit.mock.calls).toEqual([[1]]);
  });

  it('exits 0 at once when a repeated trigger finds kill settling', async () => {
    const kill = vi.fn(() => Promise.resolve());
    const { shutdown, exit } = setup(never, kill);
    shutdown.trigger('stdin closed');
    shutdown.trigger('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    expect(kill).toHaveBeenCalledOnce();
    expect(exit.mock.calls).toEqual([[0]]);
  });

  it('exits 1 and logs when kill fails, since World Machine is not confirmed gone', async () => {
    const { shutdown, exit, logger } = setup(never, () => Promise.reject(new Error('nope')));
    shutdown.trigger('SIGINT');
    shutdown.trigger('SIGINT');
    await vi.advanceTimersByTimeAsync(0);
    expect(exit.mock.calls).toEqual([[1]]);
    expect(logger.lines.some((line) => line.includes('Kill failed'))).toBe(true);
  });
});
