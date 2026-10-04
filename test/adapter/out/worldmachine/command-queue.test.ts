import { afterEach, describe, expect, it } from 'vitest';
import type { CommandChannel } from '../../../../src/adapter/out/worldmachine/channel.js';
import { CommandQueue } from '../../../../src/adapter/out/worldmachine/command-queue.js';
import { WorldMachineProcess } from '../../../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineError } from '../../../../src/domain/errors.js';
import { captureLogger, FAKE_WM, fakeEnv, waitUntil } from '../../../support/fake-wm.js';

class FakeChannel implements CommandChannel {
  readonly written: string[][] = [];
  #line: (line: string) => void = () => {};
  #exit: () => void = () => {};
  onLine(listener: (line: string) => void) {
    this.#line = listener;
  }
  onExit(listener: () => void) {
    this.#exit = listener;
  }
  write(lines: readonly string[]) {
    this.written.push([...lines]);
  }
  emit(...lines: string[]) {
    for (const line of lines) this.#line(line);
  }
  exit() {
    this.#exit();
  }
}

const echo = (id: string, i: number) => `Error: Unknown command: '__end_${id}_${i}'`;
const ids = (...values: string[]) => {
  const queue = [...values];
  return () => queue.shift() ?? 'zz';
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function rejection(promise: Promise<unknown>): Promise<WorldMachineError> {
  try {
    await promise;
  } catch (error) {
    return error as WorldMachineError;
  }
  throw new Error('expected rejection');
}

describe('CommandQueue', () => {
  it('writes each command followed by its sentinel and resolves per-command frames', async () => {
    const channel = new FakeChannel();
    const queue = new CommandQueue(channel, { timeoutMs: 1_000, nudgeMs: 0, newBatchId: ids('a1') });
    const result = queue.execute(['system info', 'device list']);
    await flush();
    expect(channel.written).toEqual([['system info', '__end_a1_0', 'device list', '__end_a1_1']]);
    channel.emit('info', echo('a1', 0), 'Devices (0 total):', echo('a1', 1));
    expect(await result).toEqual([
      { command: 'system info', output: ['info'], errors: [] },
      { command: 'device list', output: ['Devices (0 total):'], errors: [] },
    ]);
  });

  it('serialises batches: the second is written only after the first completes', async () => {
    const channel = new FakeChannel();
    const queue = new CommandQueue(channel, { timeoutMs: 1_000, nudgeMs: 0, newBatchId: ids('a1', 'a2') });
    const first = queue.execute(['one']);
    const second = queue.execute(['two']);
    await flush();
    expect(channel.written).toHaveLength(1);
    channel.emit(echo('a1', 0));
    await first;
    await flush();
    expect(channel.written[1]).toEqual(['two', '__end_a2_0']);
    channel.emit(echo('a2', 0));
    await second;
  });

  it('ignores lines that arrive while no batch is running', async () => {
    const channel = new FakeChannel();
    const queue = new CommandQueue(channel, { timeoutMs: 1_000, nudgeMs: 0, newBatchId: ids('a1') });
    channel.emit('Exiting World Machine...');
    const result = queue.execute(['x']);
    await flush();
    channel.emit('out', echo('a1', 0));
    expect((await result)[0]?.output).toEqual(['out']);
  });

  it('rejects with TIMEOUT and stays closed afterwards', async () => {
    const channel = new FakeChannel();
    const queue = new CommandQueue(channel, { timeoutMs: 50, nudgeMs: 0, newBatchId: ids('a1', 'a2') });
    expect((await rejection(queue.execute(['slow']))).code).toBe('TIMEOUT');
    expect((await rejection(queue.execute(['next']))).code).toBe('TIMEOUT');
    expect(channel.written).toHaveLength(1);
  });

  it('rejects with CRASHED when the channel exits mid-batch', async () => {
    const channel = new FakeChannel();
    const queue = new CommandQueue(channel, { timeoutMs: 1_000, nudgeMs: 0, newBatchId: ids('a1') });
    const result = queue.execute(['x']);
    await flush();
    channel.exit();
    expect((await rejection(result)).code).toBe('CRASHED');
  });

  it('nudges with empty lines while a batch is in flight, and stops once it completes', async () => {
    const channel = new FakeChannel();
    const queue = new CommandQueue(channel, { timeoutMs: 1_000, nudgeMs: 10, newBatchId: ids('a1') });
    const result = queue.execute(['x']);
    await waitUntil(() => channel.written.length >= 3, 1_000);
    expect(channel.written.slice(1).every((lines) => lines.length === 1 && lines[0] === '')).toBe(true);
    channel.emit(echo('a1', 0));
    await result;
    const writes = channel.written.length;
    // A leaked interval could only add writes, so waiting several nudge periods cannot cause a false failure.
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(channel.written).toHaveLength(writes);
  });

  it('resolves an empty batch without writing', async () => {
    const channel = new FakeChannel();
    const queue = new CommandQueue(channel, { timeoutMs: 1_000, nudgeMs: 0 });
    expect(await queue.execute([])).toEqual([]);
    expect(channel.written).toEqual([]);
  });

  it('drain waits for the running batch and refuses new ones', async () => {
    const channel = new FakeChannel();
    const queue = new CommandQueue(channel, { timeoutMs: 1_000, nudgeMs: 0, newBatchId: ids('a1') });
    const running = queue.execute(['x']);
    await flush();
    let drained = false;
    const draining = queue.drain(new WorldMachineError('CRASHED', 'shutting down')).then(() => {
      drained = true;
    });
    expect((await rejection(queue.execute(['y']))).message).toBe('shutting down');
    await flush();
    expect(drained).toBe(false);
    channel.emit(echo('a1', 0));
    await running;
    await draining;
    expect(channel.written).toHaveLength(1);
  });
});

describe('CommandQueue with the fake World Machine', () => {
  const started: WorldMachineProcess[] = [];
  afterEach(async () => {
    await Promise.all(started.splice(0).map((proc) => proc.terminate()));
  });

  async function queueFor(extra: Record<string, string> = {}, timeoutMs = 2_000, nudgeMs?: number) {
    const proc = await WorldMachineProcess.start({
      bin: FAKE_WM,
      readyTimeoutMs: 5_000,
      logger: captureLogger(),
      env: fakeEnv(extra),
    });
    started.push(proc);
    return new CommandQueue(proc, nudgeMs === undefined ? { timeoutMs } : { timeoutMs, nudgeMs });
  }

  it('frames real output, including errors from stderr, in order', async () => {
    const queue = await queueFor();
    const [bogus, info] = await queue.execute(['bogus', 'system info']);
    expect(bogus?.errors[0]).toMatch(/^Error: Unknown command: 'bogus'/);
    expect(info?.output[0]).toBe('World Machine System Info:');
  });

  it('drops log lines that arrive mid-response', async () => {
    const queue = await queueFor({ FAKE_WM_INTERLEAVE: '1' });
    const [list] = await queue.execute(['device list']);
    expect(list?.output).toHaveLength(18);
    expect(list?.output.some((line) => line.startsWith('['))).toBe(false);
  });

  it('times out when World Machine stops answering', async () => {
    const queue = await queueFor({ FAKE_WM_HANG_ON: 'device list' }, 200);
    expect((await rejection(queue.execute(['device list']))).code).toBe('TIMEOUT');
  });

  it('reports CRASHED when World Machine dies during a command', async () => {
    const queue = await queueFor({ FAKE_WM_CRASH_ON: 'device list' });
    expect((await rejection(queue.execute(['device list']))).code).toBe('CRASHED');
  });

  it('stalls a two-command batch without nudging and completes it with the default nudge', async () => {
    const stalled = await queueFor({}, 300, 0);
    expect((await rejection(stalled.execute(['bogus', 'system info']))).code).toBe('TIMEOUT');

    const nudged = await queueFor({}, 2_000);
    const [bogus, info] = await nudged.execute(['bogus', 'system info']);
    expect(bogus?.errors[0]).toMatch(/^Error: Unknown command: 'bogus'/);
    expect(info?.output[0]).toBe('World Machine System Info:');
  });
});
