/** A list ends with a blank line (spec v2b facts 57 and 63), which a command frame may already have dropped. */
export function withoutTrailingBlanks(output: readonly string[]): readonly string[] {
  let end = output.length;
  while (end > 0 && output[end - 1] === '') end--;
  return output.slice(0, end);
}
