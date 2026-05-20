import { Platform } from 'react-native';

// For Android emulator, localhost resolves to 10.0.2.2
// For a physical device, replace with your machine's local IP e.g. '192.168.1.5'
const LOCAL_HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
const LOCAL_PORT = 3000;

// ⚠️  Update PROD_HOST below to your actual Render backend URL before shipping
const PROD_HOST = 'https://quinckle-user-app-backend.onrender.com';

export const API_BASE_URL = __DEV__
  ? `http://${LOCAL_HOST}:${LOCAL_PORT}`
  : PROD_HOST;
