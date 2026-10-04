export type ProjectBinding = { readonly kind: 'fresh' } | { readonly kind: 'opened'; readonly path: string };

export type SessionState =
  | { readonly kind: 'notRunning' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'ready'; readonly binding: ProjectBinding; readonly dirty: boolean }
  | { readonly kind: 'unhealthy'; readonly reason: string };

export type SessionSummary = {
  readonly state: SessionState['kind'];
  readonly binding?: ProjectBinding;
  readonly dirty?: boolean;
  readonly reason?: string;
};

export function summarize(state: SessionState): SessionSummary {
  switch (state.kind) {
    case 'ready':
      return { state: 'ready', binding: state.binding, dirty: state.dirty };
    case 'unhealthy':
      return { state: 'unhealthy', reason: state.reason };
    default:
      return { state: state.kind };
  }
}
