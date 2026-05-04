import { AuthProvider } from '@/context/AuthContext';
import { Slot } from 'expo-router';
import 'react-native-reanimated';

export default function RootLayout() {
  return (
    <AuthProvider>
      <Slot /> 
    </AuthProvider>
  );
}