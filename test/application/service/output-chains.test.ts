import { describe, expect, it } from 'vitest';
import { readOutputChains } from '../../../src/application/service/output-chains.js';
import type { DeviceDetail, DeviceSummary, InputPort, OutputPort } from '../../../src/domain/device.js';
import type { ExportTarget } from '../../../src/domain/output-template.js';
import { exportFakes } from '../../support/port-fakes.js';

const listed = (id: number, name: string): DeviceSummary => ({ id, name, enabled: true, bypassed: false });
const detail = (
  id: number,
  name: string,
  type: string,
  inputs: readonly InputPort[] = [],
  outputs: readonly OutputPort[] = [],
  state: { enabled?: boolean; bypassed?: boolean } = {},
): DeviceDetail => ({
  id,
  name,
  type,
  enabled: state.enabled ?? true,
  bypassed: state.bypassed ?? false,
  parameters: [],
  inputs,
  outputs,
});
const fed = (port: number, device: string, sourcePort = 1): InputPort => ({
  port,
  name: 'Primary Input',
  source: { device, port: sourcePort },
});
const feeding = (device: string, port: number): OutputPort => ({
  port: 1,
  name: 'Primary Output',
  targets: [{ device, port }],
});

function chains(
  targets: readonly ExportTarget[],
  devices: readonly DeviceSummary[],
  details: readonly DeviceDetail[],
) {
  const f = exportFakes({ targets, devices, details });
  return {
    calls: f.calls,
    read: () => readOutputChains(f.exports, f.graph),
    readWith: (beforeReading: (ids: readonly number[]) => Promise<void>) =>
      readOutputChains(f.exports, f.graph, beforeReading),
  };
}

// raw/build-not-built-timing.txt l.1-46: Gradient into River into File Output.
const RIVER_GRAPH = [listed(1, 'Gradient'), listed(2, 'River'), listed(3, 'Height Output')];
const RIVER_DETAILS = [
  detail(3, 'Height Output', 'Height Output', [fed(1, 'River')]),
  detail(2, 'River', 'River', [
    { port: 1, name: 'Terrain Input', source: { device: 'Gradient', port: 1 } },
    { port: 2, name: 'River Parameters' },
  ]),
  detail(1, 'Gradient', 'Gradient'),
];
const RIVER_TARGETS = [{ device: 'Height Output', template: '<WORK>/river-height.png' }];

describe('readOutputChains (build-not-built design section 4)', () => {
  it('hands every listed id to beforeReading once, before any device is read (step 2)', async () => {
    const c = chains(RIVER_TARGETS, RIVER_GRAPH, RIVER_DETAILS);
    await c.readWith(async (ids) => void c.calls.push(`before ${ids.join(',')}`));
    expect(c.calls).toEqual([
      'export list',
      'device list',
      'before 1,2,3',
      'device info #3',
      'device info #2',
      'device info #1',
    ]);
  });

  it('does not call beforeReading when no output is configured', async () => {
    const c = chains([], RIVER_GRAPH, RIVER_DETAILS);
    await c.readWith(async () => void c.calls.push('before'));
    expect(c.calls).toEqual(['export list']);
  });

  it('reads the output and every device upstream of it, breadth first', async () => {
    const c = chains(RIVER_TARGETS, RIVER_GRAPH, RIVER_DETAILS);
    expect(await c.read()).toEqual({
      outputs: [3],
      graph: [
        { id: 3, name: 'Height Output', type: 'Height Output', enabled: true, bypassed: false, sources: [2] },
        { id: 2, name: 'River', type: 'River', enabled: true, bypassed: false, sources: [1] },
        { id: 1, name: 'Gradient', type: 'Gradient', enabled: true, bypassed: false, sources: [] },
      ],
    });
    expect(c.calls).toEqual([
      'export list',
      'device list',
      'device info #3',
      'device info #2',
      'device info #1',
    ]);
  });

  it('carries enabled and bypassed as get_device reads them', async () => {
    const details = [
      RIVER_DETAILS[0],
      detail(2, 'River', 'River', [], [], { enabled: false, bypassed: true }),
    ];
    const c = chains(
      RIVER_TARGETS,
      RIVER_GRAPH,
      details.filter((d): d is DeviceDetail => d !== undefined),
    );
    expect((await c.read()).graph[1]).toMatchObject({ id: 2, enabled: false, bypassed: true, sources: [] });
  });

  it('reads nothing more when no output is configured (section 4 step 1)', async () => {
    const c = chains([], RIVER_GRAPH, RIVER_DETAILS);
    expect(await c.read()).toEqual({ outputs: [], graph: [] });
    expect(c.calls).toEqual(['export list']);
  });

  it('reads two outputs of one name and their shared River once (raw/river-failing-graph.txt l.38-60, l.144-148)', async () => {
    const devices = [listed(536, 'Height Output'), listed(537, 'Height Output'), listed(538, 'River')];
    const details = [
      detail(536, 'Height Output', 'Height Output', [fed(1, 'River')]),
      detail(537, 'Height Output', 'Height Output', [fed(1, 'River', 4)]),
      detail(538, 'River', 'River'),
    ];
    const c = chains([{ device: 'Height Output', template: '<WORK>/full-height.png' }], devices, details);
    const read = await c.read();
    expect(read.outputs).toEqual([536, 537]);
    expect(read.graph.map((device) => [device.id, device.sources])).toEqual([
      [536, [538]],
      [537, [538]],
      [538, []],
    ]);
    expect(c.calls.filter((call) => call === 'device info #538')).toHaveLength(1);
  });

  it('follows the source that lists the input when two devices share its name (fact 82)', async () => {
    const devices = [
      listed(1, 'Gradient'),
      listed(2, 'Gradient'),
      listed(3, 'Combiner'),
      listed(4, 'Height Output'),
    ];
    const details = [
      detail(4, 'Height Output', 'Height Output', [fed(1, 'Combiner')]),
      detail(3, 'Combiner', 'Combiner', [fed(1, 'Gradient'), fed(2, 'Gradient')]),
      detail(1, 'Gradient', 'Gradient', [], [feeding('Combiner', 2)]),
      detail(2, 'Gradient', 'Gradient', [], [feeding('Combiner', 1)]),
    ];
    const c = chains([{ device: 'Height Output', template: 'out.png' }], devices, details);
    expect((await c.read()).graph.map((device) => [device.id, device.sources])).toEqual([
      [4, [3]],
      [3, [2, 1]],
      [2, []],
      [1, []],
    ]);
    expect(c.calls).toEqual([
      'export list',
      'device list',
      'device info #4',
      'device info #3',
      'device info #1',
      'device info #2',
    ]);
  });

  it.each([
    [
      'two candidates that both list the input',
      [feeding('Combiner', 1), feeding('Combiner', 1)],
      "The source of 'Combiner' input 1 cannot be identified: 'Gradient' is a name #1, #2 share, and #1, #2 each list 'Combiner' input 1 among their output targets",
    ],
    [
      'two candidates that do not list the input',
      [feeding('Curves', 1), feeding('Curves', 1)],
      "The source of 'Combiner' input 1 cannot be identified: 'Gradient' is a name #1, #2 share, and none of them lists 'Combiner' input 1 among its output targets",
    ],
  ])(
    'fails UNEXPECTED_OUTPUT for a source it cannot identify: %s (plan decision B4)',
    async (_label, outs, message) => {
      const devices = [listed(1, 'Gradient'), listed(2, 'Gradient'), listed(3, 'Combiner')];
      const details = [
        detail(3, 'Combiner', 'Combiner', [fed(1, 'Gradient')]),
        detail(1, 'Gradient', 'Gradient', [], [outs[0] as OutputPort]),
        detail(2, 'Gradient', 'Gradient', [], [outs[1] as OutputPort]),
      ];
      await expect(
        chains([{ device: 'Combiner', template: 'x.png' }], devices, details).read(),
      ).rejects.toMatchObject({
        code: 'UNEXPECTED_OUTPUT',
        message,
      });
    },
  );

  it('fails UNEXPECTED_OUTPUT for a source name no listed device has (plan decision B4)', async () => {
    const devices = [listed(3, 'Height Output')];
    const details = [detail(3, 'Height Output', 'Height Output', [fed(1, 'Missing')])];
    await expect(chains(RIVER_TARGETS, devices, details).read()).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
      message:
        "The source of 'Height Output' input 1 cannot be identified: 'Missing' is a name no listed device has",
    });
  });

  it('fails UNEXPECTED_OUTPUT for an export list name no listed device has (Review Focus 2, plan decision B3)', async () => {
    const c = chains([{ device: 'Splatmap', template: 'x.png' }], RIVER_GRAPH, RIVER_DETAILS);
    await expect(c.read()).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
      message: "export list names 'Splatmap', which no device in device list has",
    });
    expect(c.calls).toEqual(['export list', 'device list']);
  });

  it('refuses an ambiguous export list row before matching names, even when its guessed name matches (plan decision B3a)', async () => {
    // parsers/export-list.ts l.19-24: a row with more than one ' -> ' is a guess, flagged ambiguous. Here the guess is
    // 'Height Output', which #3 has, so only the refusal keeps an unread output from counting as built.
    const c = chains(
      [{ device: 'Height Output', template: "a' -> b/<name>.png", ambiguous: true }],
      RIVER_GRAPH,
      RIVER_DETAILS,
    );
    await expect(c.read()).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
      message:
        "export list row for 'Height Output' holds more than one ' -> ', so the output it names cannot be read reliably",
    });
    expect(c.calls).toEqual(['export list']);
  });

  it('passes a failed device read on', async () => {
    await expect(chains(RIVER_TARGETS, RIVER_GRAPH, []).read()).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      message: 'World Machine rejected "device select #3"',
    });
  });
});
