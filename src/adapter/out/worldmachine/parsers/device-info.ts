import { unexpectedOutput } from './unexpected.js';

const FIELD = /^\s+(Name|Type|Enabled|Bypass):\s+(.*?)\s*$/;

export function parseDeviceInfo(output: readonly string[]): {
  name: string;
  type: string;
  enabled: boolean;
  bypassed: boolean;
} {
  if (output[0]?.trim() !== 'Selected device:') throw unexpectedOutput('device info', output);
  const fields = new Map<string, string>();
  for (const line of output.slice(1)) {
    const match = FIELD.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) fields.set(match[1], match[2]);
  }
  const name = fields.get('Name');
  const type = fields.get('Type');
  const enabled = fields.get('Enabled');
  const bypass = fields.get('Bypass');
  if (!name || !type || (enabled !== 'yes' && enabled !== 'no') || (bypass !== 'yes' && bypass !== 'no')) {
    throw unexpectedOutput('device info', output);
  }
  return { name, type, enabled: enabled === 'yes', bypassed: bypass === 'yes' };
}
