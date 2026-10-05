import type { RenamedDevice } from '../../../../domain/graph-edit.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type RenameDeviceCommand = { readonly device: string; readonly name: string };
export type RenameDeviceView = RenamedDevice & { readonly session: SessionSummary };
export interface RenameDeviceCommandPort {
  renameDevice(command: RenameDeviceCommand): Promise<RenameDeviceView>;
}
