import type { WireConnection, WireDisconnection, WireEndpoint } from '../../../domain/graph-edit.js';

/**
 * Wire edits (spec section 7). Devices are names or `#<id>`; ports are 1-based and default to 1. Callers run each
 * method inside `WorldMachineSessionPort.exclusive`.
 */
export interface WireEditPort {
  connect(source: WireEndpoint, destination: WireEndpoint): Promise<WireConnection>;
  disconnect(source: WireEndpoint, destination: WireEndpoint): Promise<WireDisconnection>;
}
