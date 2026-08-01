import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.com.quimstock.app',
  appName: 'QuimStock',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
