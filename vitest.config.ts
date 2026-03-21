import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/extension.ts',       // activation wiring
        'src/commands/**',         // VSCode UI glue (quickpick, inputbox)
        'src/providers/**',        // VSCode decoration rendering
        'src/ai/lmService.ts',    // VSCode LM API wrapper
        'src/ai/criticalDetector.ts',  // tested via parseRegions; scan methods are VSCode integration
        'src/ai/diaryGenerator.ts',    // tested via parseEntries; suggest methods are VSCode integration
        'src/models/reviewMarker.ts',  // pure type definitions
        'src/models/criticalFlag.ts',  // pure type definitions
      ],
      reporter: ['text', 'text-summary'],
    },
    alias: {
      vscode: path.resolve(__dirname, 'test/__mocks__/vscode.ts'),
    },
  },
});
