import type { WireConnection, WireEndpoint } from '../../../../domain/graph-edit.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type ConnectDevicesCommand = { readonly source: WireEndpoint; readonly destination: WireEndpoint };
export type ConnectDevicesView = WireConnection & { readonly session: SessionSummary };
export interface ConnectDevicesCommandPort {
  connectDevices(command: ConnectDevicesCommand): Promise<ConnectDevicesView>;
}
