import { defineConfig, mergeConfig } from 'vitest/config';
import path from 'node:path';

const baseConfig = defineConfig({
  test: {
    globals: true,
    environment: 'node',
    dangerouslyIgnoreUnhandledErrors: true,
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
      '@calendar-sdk/google': path.resolve(__dirname, '../providers/google/dist/index.js'),
      '@calendar-sdk/microsoft': path.resolve(__dirname, '../providers/microsoft/dist/index.js'),
    },
  },
});

export default mergeConfig(baseConfig, defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/sdk.test.ts'],
  },
}));

export const integrationConfig = mergeConfig(baseConfig, defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    dangerouslyIgnoreUnhandledErrors: true,
    testTimeout: 120000,
    hookTimeout: 120000,
  },
}));
