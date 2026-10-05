/** Project lifecycle commands. Paths are already authorised and canonical. */
export interface ProjectGraphWritePort {
  openProject(path: string): Promise<void>;
  createProject(): Promise<void>;
  /** `allowReplace` false means the target must still be absent right before World Machine writes. */
  saveProject(path: string, allowReplace: boolean): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
}
