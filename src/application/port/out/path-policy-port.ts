export type SaveTarget = { readonly path: string; readonly exists: boolean };

export interface PathPolicyPort {
  /** Returns the canonical path of an existing `.tmd` file inside an allowed root. */
  authorizeExistingProject(input: string): Promise<string>;
  /** Returns the canonical path to save to, in an existing directory inside an allowed root. */
  authorizeSaveTarget(input: string): Promise<SaveTarget>;
}
