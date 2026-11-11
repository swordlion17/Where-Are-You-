import type { CapacitorConfig } from '@capacitor/cli';

// appId confirmed 2026-11-11. It becomes permanent with the first Google Play / App Store upload, so don't change it.
const config: CapacitorConfig = {
  appId: 'com.cakegame.whereareyou',
  appName: 'Where Are You?',
  webDir: 'dist',
  backgroundColor: '#1a1433',
  android: {
    backgroundColor: '#1a1433',
  },
};

export default config;
