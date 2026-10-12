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

export type InputPort = { readonly port: number; readonly name: string; readonly source?: PortLink };

export type OutputPort = {
  readonly port: number;
  readonly name: string;
  readonly targets: readonly PortLink[];
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
};
