export type SaveTarget = { readonly path: string; readonly exists: boolean };

export interface PathPolicyPort {
  /** Returns the canonical path of an existing `.tmd` file inside an allowed root. */
  authorizeExistingProject(input: string): Promise<string>;
  /** Returns the canonical path to save to, in an existing directory inside an allowed root. */
  authorizeSaveTarget(input: string): Promise<SaveTarget>;
  /**
   * Returns the canonical path of a file World Machine may write as build output: its folder exists and lies in an
   * allowed root, and the path is not an existing symlink or non-file (spec v2a section 5). REFUSED otherwise, with
   * the reason in the message.
   */
  authorizeOutputPath(input: string): Promise<string>;
}
