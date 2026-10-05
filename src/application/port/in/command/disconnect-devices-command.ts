import type { WireDisconnection, WireEndpoint } from '../../../../domain/graph-edit.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type DisconnectDevicesCommand = { readonly source: WireEndpoint; readonly destination: WireEndpoint };
export type DisconnectDevicesView = WireDisconnection & { readonly session: SessionSummary };
export interface DisconnectDevicesCommandPort {
  disconnectDevices(command: DisconnectDevicesCommand): Promise<DisconnectDevicesView>;
}
