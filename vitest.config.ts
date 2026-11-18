import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The build runs first (test/support/build.ts), so every test finds a current dist.
    // One temporary root per run, removed at the end (test/support/temp-root.ts).
    globalSetup: ['test/support/build.ts', 'test/support/temp-root.ts'],
    testTimeout: 15_000,
  },
});
