import type { CapacitorConfig } from '@capacitor/cli';

// NOTE: appId is permanent once the app is on Google Play / the App Store. Confirm it before the first upload.
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
