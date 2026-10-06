export type ProjectBinding = { readonly kind: 'fresh' } | { readonly kind: 'opened'; readonly path: string };

export type SessionState =
  | { readonly kind: 'notRunning' }
  | { readonly kind: 'starting' }
  | {
      readonly kind: 'ready';
      readonly binding: ProjectBinding;
      readonly dirty: boolean;
      /** World Machine started with a project recovered from a crashed session, and it is still the one bound. */
      readonly recovered?: true;
    }
  | { readonly kind: 'unhealthy'; readonly reason: string };

export type SessionSummary = {
  readonly state: SessionState['kind'] | 'stopping';
  readonly binding?: ProjectBinding;
  readonly dirty?: boolean;
  readonly reason?: string;
  readonly recovered?: boolean;
};

export function summarize(state: SessionState): SessionSummary {
  switch (state.kind) {
    case 'ready':
      return {
        state: 'ready',
        binding: state.binding,
        dirty: state.dirty,
        ...(state.recovered ? { recovered: true } : {}),
      };
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
