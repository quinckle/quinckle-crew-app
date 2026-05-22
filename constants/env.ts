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

const PROD_HOST = 'https://quinckle-user-app-backend.onrender.com';

// Set to true when testing against the production backend from Expo Go.
// Set to false only when running the backend locally on your machine.
const USE_PROD_BACKEND_IN_DEV = true;

export const API_BASE_URL = (!__DEV__ || USE_PROD_BACKEND_IN_DEV)
  ? PROD_HOST
  : `http://${LOCAL_HOST}:${LOCAL_PORT}`;
