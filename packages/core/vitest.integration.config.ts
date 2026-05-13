import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@calendar-sdk/google': path.resolve(__dirname, '../providers/google/dist/index.js'),
      '@calendar-sdk/microsoft': path.resolve(__dirname, '../providers/microsoft/dist/index.js'),
    },
  },
});