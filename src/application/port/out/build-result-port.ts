/**
 * Build-not-built design section 7: which devices are built. World Machine purges every result before a full build
 * (fact 94), so after one the results are that build's.
 */
export interface BuildResultPort {
  /** The ids among `ids` whose device has a result at the scene resolution (facts 93, 95), in the order given. */
  builtDevices(ids: readonly number[]): Promise<number[]>;
}
