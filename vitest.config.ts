import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      statements: 0.9,
      branches: 0.9,
      functions: 0.9,
      lines: 0.9
    }
  }
});