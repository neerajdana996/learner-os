import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'learnos',
    description: 'One retrieval question at a time. Never teaches — only helps you remember.',
    permissions: ['storage', 'alarms'],
    // TODO(T-027): host_permissions for the backend origin once auth lands.
  },
});
