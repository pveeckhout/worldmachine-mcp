export type DeviceSummary = {
  readonly id: number;
  readonly name: string;
  readonly kind?: string;
  readonly enabled: boolean;
  /** Omitted when unknown: `device list` hides bypass on a disabled device (spec fact 29). */
  readonly bypassed?: boolean;
};

export type Parameter = {
  readonly name: string;
  readonly type: string;
  readonly value: string;
  /** An enum's labels in index order; set only by the World Machine adapter (enum-options design section 4). */
  readonly options?: readonly string[];
};

export type PortLink = { readonly device: string; readonly port: number };

export type InputPort = {
  readonly port: number;
  readonly name: string;
  readonly source?: PortLink;
  /** The names of the output classes this input accepts; set only by the World Machine adapter (port-types section 6). */
  readonly accepts?: readonly string[];
};

export type OutputPort = {
  readonly port: number;
  readonly name: string;
  readonly targets: readonly PortLink[];
  /** Its output class's name; set only by the World Machine adapter (port-types design section 6). */
  readonly type?: string;
};

export type DeviceDetail = {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly enabled: boolean;
  readonly bypassed: boolean;
  readonly parameters: readonly Parameter[];
  readonly inputs: readonly InputPort[];
  readonly outputs: readonly OutputPort[];
  /** Why enum rows have no options, one entry per distinct reason (enum-options design section 4). */
  readonly enumOptionsNote?: readonly string[];
  /**
   * Port-types design section 6: whether the ports carry catalogued types. Every device view says one or the other
   * (Codex round 1 ruling S1); the World Machine adapter sets it.
   */
  readonly portTypes: 'catalogued' | 'unknown';
};
