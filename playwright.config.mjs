import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e', fullyParallel:false, workers:1, timeout:60000,
  use:{ baseURL:'http://127.0.0.1:3100', headless:true, screenshot:'only-on-failure', trace:'retain-on-failure' },
  webServer:{ command:'node scripts/dev.mjs --web', url:'http://127.0.0.1:3100/api/health', timeout:120000, reuseExistingServer:false, env:{ PORT:'3100',BARMETO_SERVICE_PORT:'4319',BARMETO_DATA_DIR:`.barmeto/e2e-${Date.now()}` } },
});
