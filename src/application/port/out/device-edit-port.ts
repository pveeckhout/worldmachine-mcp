import type { DeviceSummary } from '../../../domain/device.js';
import type { DeviceEnabledState, RenamedDevice } from '../../../domain/graph-edit.js';

/**
 * Device edits (spec section 7). `device` arguments are a device name or `#<id>`; the adapter resolves them against
 * its own `device list` and refuses a device it does not list. Callers run each method inside
 * `WorldMachineSessionPort.exclusive`. A change World Machine accepted marks the session dirty.
 */
export interface DeviceEditPort {
  /** Adds a device of an exact World Machine type and, when `name` is given, renames it. Returns its listed row. */
  addDevice(type: string, name?: string): Promise<DeviceSummary>;
  renameDevice(device: string, name: string): Promise<RenamedDevice>;
  /** Reads the device back; dirty only when its state changed (spec section 7). */
  setDeviceEnabled(device: string, enabled: boolean): Promise<DeviceEnabledState>;
  /** Returns the deleted device's row from before the delete. */
  deleteDevice(device: string): Promise<DeviceSummary>;
  /**
   * `device organize`: lays the graph out by processing order in the World Machine window (spec v2b fact 62). The
   * console shows no layout, so nothing is read back.
   */
  organize(): Promise<void>;
}
