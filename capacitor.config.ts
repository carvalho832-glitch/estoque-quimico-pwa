import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.com.quimstock.app.novo',
  appName: 'QuimStock Novo',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
