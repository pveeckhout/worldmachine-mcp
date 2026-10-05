import type { ParameterUpdate, ParameterValue } from '../../../domain/graph-edit.js';

/**
 * Parameter edits (spec section 7, `update_device_parameters`). `device` is a name or `#<id>`. Every item is checked
 * against `param list` first and the whole call is refused if any is invalid. Callers run it inside
 * `WorldMachineSessionPort.exclusive`.
 */
export interface ParameterEditPort {
  updateParameters(
    device: string,
    values: Readonly<Record<string, ParameterValue>>,
  ): Promise<ParameterUpdate>;
}
