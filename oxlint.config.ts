import { defineConfig } from 'oxlint';
import type { OxlintConfig } from 'oxlint';
import { oxlintLibraryConfig, testOverrides, configOverrides } from '@finografic/oxc-config/oxlint';

export default defineConfig({
  ...oxlintLibraryConfig,
  overrides: [testOverrides, configOverrides],
} satisfies OxlintConfig);
