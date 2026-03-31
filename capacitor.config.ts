import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.lenniaconrad.chessweb',
  appName: 'Chess Web',
  webDir: 'apps/web/dist',
  server: {
    url: 'https://rookbook.vercel.app',
    cleartext: false
  }
};

export default config;
