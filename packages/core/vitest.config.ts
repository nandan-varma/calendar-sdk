import { defineConfig, mergeConfig } from 'vitest/config';
import path from 'node:path';

const baseConfig = defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'dist/**',
        'node_modules/**',
        'tests/**',
        '**/*.config.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
    },
    exclude: ['node_modules', 'dist'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@nandan-varma/calendar-sdk-google': path.resolve(__dirname, '../providers/google/src/index.ts'),
      '@nandan-varma/calendar-sdk-microsoft': path.resolve(__dirname, '../providers/microsoft/src/index.ts'),
    },
  },
});

export default mergeConfig(baseConfig, defineConfig({
  test: {
    include: ['tests/basic.test.ts', 'tests/unit/**/*.test.ts', 'tests/integration/sdk.test.ts'],
  },
}));

export const integrationConfig = mergeConfig(baseConfig, defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
}));
