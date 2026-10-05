import { unexpectedOutput } from './unexpected.js';

/** `param get <ref>` prints `<ref> = <value>`, the reference as given (raw/v6b-param-set.txt l.81-82). */
export function parseParamGet(output: readonly string[], reference: string): string {
  const prefix = `${reference} = `;
  const line = output.find((candidate) => candidate.startsWith(prefix));
  if (line === undefined) throw unexpectedOutput('param get', output);
  return line.slice(prefix.length);
}
