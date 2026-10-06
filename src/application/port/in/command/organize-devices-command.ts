import type { SessionSummary } from '../../../../domain/session.js';

export type OrganizeDevicesCommand = Readonly<Record<string, never>>;
export type OrganizeDevicesView = { readonly session: SessionSummary };
export interface OrganizeDevicesCommandPort {
  organizeDevices(command: OrganizeDevicesCommand): Promise<OrganizeDevicesView>;
}
