import { AuthProvider } from '@/context/AuthContext';
import { Stack } from 'expo-router';
import 'react-native-reanimated';

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade_from_bottom',
          animationDuration: 180,
        }}
      />
    </AuthProvider>
  );
}