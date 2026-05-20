import { Platform } from 'react-native';

// ── LOCAL DEV HOST ─────────────────────────────────────────────────────────────
// Testing on physical phones? Set PHYSICAL_DEVICE_IP to your laptop's WiFi IP.
// Run `ipconfig` in PowerShell → look for IPv4 under your WiFi adapter.
// Leave empty ('') when using the Android emulator only.
const PHYSICAL_DEVICE_IP = '';  // e.g. '192.168.1.105'

const LOCAL_HOST = PHYSICAL_DEVICE_IP
  ? PHYSICAL_DEVICE_IP
  : Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
const LOCAL_PORT = 3000;

// ⚠️  Update PROD_HOST below to your actual Render backend URL before shipping
const PROD_HOST = 'https://quinckle-user-app-backend.onrender.com';

export const API_BASE_URL = __DEV__
  ? `http://${LOCAL_HOST}:${LOCAL_PORT}`
  : PROD_HOST;
