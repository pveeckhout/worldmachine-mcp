export type Scene = {
  readonly name: string;
  readonly index: number;
  readonly count: number;
  readonly originKm: { readonly x: number; readonly y: number };
  readonly sizeKm: { readonly width: number; readonly height: number };
  readonly resolution: number;
  readonly locked: boolean;
};

export type SceneSummary = {
  readonly index: number;
  readonly name: string;
  readonly widthKm: number;
  readonly heightKm: number;
  readonly resolution: number;
  readonly current: boolean;
};
