import type { DeviceSummary } from './device.js';

/** A device as an edit result names it: its stable id and its current name. */
export type DeviceRef = { readonly id: number; readonly name: string };

export type RenamedDevice = { readonly device: DeviceSummary; readonly previousName: string };

/** `enabled` is the state World Machine reports after the command; `changed` compares it with the state before. */
export type DeviceEnabledState = {
  readonly device: DeviceRef;
  readonly enabled: boolean;
  readonly changed: boolean;
};

/** A parameter value as a tool call gives it; World Machine receives it as text. */
export type ParameterValue = string | number | boolean;

export type ParameterOutcome = {
  readonly name: string;
  readonly type: string;
  /** The value text sent with `param set`. */
  readonly requested: string;
  readonly outcome: 'applied' | 'rejected';
  /** What `param get` printed afterwards, in World Machine's display units. */
  readonly value: string;
  /** World Machine's `Error:` text for a rejected item, without log or licence lines (spec section 8). */
  readonly worldMachineMessage?: string;
};

export type ParameterUpdate = {
  readonly device: DeviceRef;
  readonly parameters: readonly ParameterOutcome[];
};

/** One end of a wire as a tool call names it. `port` is 1-based; World Machine uses port 1 when it is omitted. */
export type WireEndpoint = { readonly device: string; readonly port?: number };

export type WireEnd = { readonly id: number; readonly name: string; readonly port: number };

export type WireConnection = {
  readonly source: WireEnd;
  readonly destination: WireEnd;
  /** false when the wire already existed and nothing was sent. */
  readonly created: boolean;
};

export type WireDisconnection = {
  readonly source: WireEnd;
  readonly destination: WireEnd;
  /** false when there was no such wire and nothing was sent (spec section 7). */
  readonly removed: boolean;
};

/** The scene settings `configure_scene` changes; at least one is given. */
export type SceneChanges = {
  readonly name?: string;
  readonly originKm?: { readonly x: number; readonly y: number };
  readonly sizeKm?: { readonly width: number; readonly height: number };
  readonly resolution?: number;
};
