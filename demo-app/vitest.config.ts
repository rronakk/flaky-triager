import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: ['default', ['junit', { outputFile: 'test-results/junit-vitest.xml' }]],
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          retry: 2,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          retry: 2,
        },
      },
      {
        test: {
          name: 'api',
          include: ['tests/api/**/*.test.ts'],
          retry: 2,
        },
      },
    ],
  },
});
