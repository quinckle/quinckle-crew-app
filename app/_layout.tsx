import { AuthProvider } from '@/context/AuthContext';
import { Stack } from 'expo-router';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'fade_from_bottom',
            animationDuration: 180,
          }}
        />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}