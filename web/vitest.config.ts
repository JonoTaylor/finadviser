import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Vitest is scoped to the *pure* function tests so far - the mortgage-
// interest calculator is the priority. Repo / API tests would need a
// real Postgres + Drizzle harness which is a separate workstream.
//
// `tsconfigPaths` makes the `@/...` aliases from tsconfig.json resolve
// the same way they do at runtime.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
