import { WorldMachineError } from '../../domain/errors.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export function refuseUnsavedChanges(session: WorldMachineSessionPort, discardUnsaved: boolean): void {
  if (session.status().session.dirty === true && !discardUnsaved) {
    throw new WorldMachineError(
      'REFUSED',
      'The project has unsaved changes. Save it, or pass discard_unsaved: true to discard them.',
    );
  }
}

export function requireOpenProject(session: WorldMachineSessionPort): void {
  if (session.status().session.state !== 'ready') {
    throw new WorldMachineError('REFUSED', 'No project is open in World Machine.');
  }
}
