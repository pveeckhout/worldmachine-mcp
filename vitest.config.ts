import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // One temporary root per run, removed at the end (test/support/temp-root.ts).
    globalSetup: ['test/support/temp-root.ts'],
    testTimeout: 15_000,
  },
});
