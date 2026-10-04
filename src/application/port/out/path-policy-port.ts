export interface PathPolicyPort {
  /** Returns the canonical path of an existing `.tmd` file inside an allowed root. */
  authorizeExistingProject(input: string): Promise<string>;
}
