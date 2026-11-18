import type { VerdictReport } from '../../../../domain/catalog.js';
import type { WireConnection, WireEndpoint } from '../../../../domain/graph-edit.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type ConnectDevicesCommand = { readonly source: WireEndpoint; readonly destination: WireEndpoint };
export type ConnectDevicesView = Omit<WireConnection, 'typing'> & {
  /** Set when World Machine's verdict contradicted the catalog's prediction. */
  readonly verdict?: VerdictReport;
  readonly session: SessionSummary;
};
export interface ConnectDevicesCommandPort {
  connectDevices(command: ConnectDevicesCommand): Promise<ConnectDevicesView>;
}
