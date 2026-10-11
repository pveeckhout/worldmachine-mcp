import type { DeviceDetail, InputPort } from './device.js';
import { foldCase, listedName } from './device-name.js';
import type { PlanStep } from './graph-plan.js';

export type Change<T> = { readonly before: T; readonly after: T };

export type AddedDevice = {
  readonly id: number;
  readonly type: string;
  readonly enabled: boolean;
  /** The parameters the spec set, as read back (display units). */
  readonly parameters: Readonly<Record<string, string>>;
  /** Wired inputs by port, as `"<device>.<port>"`. */
  readonly inputs: Readonly<Record<string, string>>;
};

export type DiffEntry =
  | { readonly device: string; readonly change: 'added'; readonly after: AddedDevice }
  | {
      readonly device: string;
      readonly change: 'removed';
      readonly before: { readonly id: number; readonly type: string };
    }
  | {
      readonly device: string;
      readonly change: 'changed';
      readonly id: number;
      readonly enabled?: Change<boolean>;
      readonly parameters?: Readonly<Record<string, Change<string>>>;
      readonly inputs?: Readonly<Record<string, Change<string | null>>>;
    };

export type AppliedDevices = {
  /** The state's details from before the first step. */
  readonly before: readonly DeviceDetail[];
  /** Read back after the last step: every device a step touched that still exists. */
  readonly after: readonly DeviceDetail[];
  /** The ids the adds returned, by `foldCase` of the spec name. */
  readonly addedIds: ReadonlyMap<string, number>;
};

/** An input's source as plan steps write it, `"<device>.<port>"`; null without a wire. */
export function sourceText(input: InputPort | undefined): string | null {
  return input?.source === undefined ? null : `${listedName(input.source.device)}.${input.source.port}`;
}

const byId = (list: readonly DeviceDetail[], id: number | undefined): DeviceDetail | undefined =>
  list.find((device) => device.id === id);
const nonEmpty = (record: object): boolean => Object.keys(record).length > 0;

/**
 * Spec v3 section 6: the devices the steps touched, read back. A parameter appears only when its read-back value
 * changed, and a changed device with no visible change is left out.
 */
export function graphDiff(steps: readonly PlanStep[], devices: AppliedDevices): DiffEntry[] {
  const groups = new Map<string, PlanStep[]>();
  for (const step of steps) {
    // Removed devices by id: two removed devices may share a name (fact 30).
    const key = step.op === 'remove' ? `#${step.id}` : foldCase(step.device);
    groups.set(key, [...(groups.get(key) ?? []), step]);
  }
  const entries: DiffEntry[] = [];
  for (const [key, own] of groups) {
    const first = own[0];
    if (first === undefined) continue;
    const parameterNames = own.flatMap((step) => (step.op === 'set-parameter' ? [step.name] : []));
    if (first.op === 'remove') {
      const before = byId(devices.before, first.id);
      if (before !== undefined) {
        entries.push({
          device: first.device,
          change: 'removed',
          before: { id: before.id, type: before.type },
        });
      }
      continue;
    }
    if (own.some((step) => step.op === 'add')) {
      const after = byId(devices.after, devices.addedIds.get(key));
      if (after === undefined) continue;
      entries.push({
        device: first.device,
        change: 'added',
        after: {
          id: after.id,
          type: after.type,
          enabled: after.enabled,
          parameters: Object.fromEntries(
            parameterNames.flatMap((name) => {
              const row = after.parameters.find((parameter) => parameter.name === name);
              return row === undefined ? [] : [[name, row.value]];
            }),
          ),
          inputs: Object.fromEntries(
            after.inputs.flatMap((input) => {
              const text = sourceText(input);
              return text === null ? [] : [[String(input.port), text]];
            }),
          ),
        },
      });
      continue;
    }
    const id = own.flatMap((step) => ('id' in step && step.id !== undefined ? [step.id] : []))[0];
    const before = byId(devices.before, id);
    const after = byId(devices.after, id);
    if (id === undefined || before === undefined || after === undefined) continue;
    const enabled =
      before.enabled === after.enabled ? undefined : { before: before.enabled, after: after.enabled };
    const parameters = Object.fromEntries(
      parameterNames.flatMap((name) => {
        const was = before.parameters.find((parameter) => parameter.name === name)?.value;
        const is = after.parameters.find((parameter) => parameter.name === name)?.value;
        return was === undefined || is === undefined || was === is
          ? []
          : [[name, { before: was, after: is }]];
      }),
    );
    const ports = [
      ...new Set(
        own.flatMap((step) => (step.op === 'connect' || step.op === 'disconnect' ? [step.port] : [])),
      ),
    ];
    const inputs = Object.fromEntries(
      ports.flatMap((port) => {
        const was = sourceText(before.inputs.find((input) => input.port === port));
        const is = sourceText(after.inputs.find((input) => input.port === port));
        return was === is ? [] : [[String(port), { before: was, after: is }]];
      }),
    );
    if (enabled === undefined && !nonEmpty(parameters) && !nonEmpty(inputs)) continue;
    entries.push({
      device: first.device,
      change: 'changed',
      id,
      ...(enabled === undefined ? {} : { enabled }),
      ...(nonEmpty(parameters) ? { parameters } : {}),
      ...(nonEmpty(inputs) ? { inputs } : {}),
    });
  }
  return entries;
}
