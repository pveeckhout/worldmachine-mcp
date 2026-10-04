import { describe, expect, it } from 'vitest';
import { isLicenceText, parseLogLine } from '../../../../src/adapter/out/worldmachine/log-lines.js';

describe('parseLogLine', () => {
  it('recognises World Machine log lines with padded levels', () => {
    expect(parseLogLine('[Info       ] Startup: Completed. Transferring control into event loop.')).toEqual({
      level: 'info',
      text: 'Startup: Completed. Transferring control into event loop.',
    });
    expect(parseLogLine('[Warning    ] Console: Shortcut shadows group')).toEqual({
      level: 'warning',
      text: 'Console: Shortcut shadows group',
    });
  });

  it('ignores command output and error lines', () => {
    expect(parseLogLine('Devices (17 total):')).toBeUndefined();
    expect(parseLogLine("Error: Unknown command: 'x'. Type 'help' for a list of commands.")).toBeUndefined();
    expect(parseLogLine('  #1     Height Output')).toBeUndefined();
  });
});

describe('isLicenceText', () => {
  it('matches both spellings in any case', () => {
    expect(isLicenceText('License Manager.Checkin: License returned')).toBe(true);
    expect(isLicenceText('licence seat')).toBe(true);
    expect(isLicenceText('Devices (0 total):')).toBe(false);
  });
});
