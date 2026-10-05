import type { ParameterUpdate, ParameterValue } from '../../../../domain/graph-edit.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type UpdateDeviceParametersCommand = {
  readonly device: string;
  readonly parameters: Readonly<Record<string, ParameterValue>>;
};
export type UpdateDeviceParametersView = ParameterUpdate & { readonly session: SessionSummary };
export interface UpdateDeviceParametersCommandPort {
  updateDeviceParameters(command: UpdateDeviceParametersCommand): Promise<UpdateDeviceParametersView>;
}
