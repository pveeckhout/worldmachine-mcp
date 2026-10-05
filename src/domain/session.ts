export type ProjectBinding = { readonly kind: 'fresh' } | { readonly kind: 'opened'; readonly path: string };

export type SessionState =
  | { readonly kind: 'notRunning' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'ready'; readonly binding: ProjectBinding; readonly dirty: boolean }
  | { readonly kind: 'unhealthy'; readonly reason: string };

export type SessionSummary = {
  readonly state: SessionState['kind'] | 'stopping';
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
    case 'notRunning':
    case 'starting':
      return { state: state.kind };
    default: {
      // A new SessionState kind fails to compile here until it is summarised.
      const unhandled: never = state;
      return unhandled;
    }
  }
}
