// app/index.tsx
import { Redirect, useRootNavigationState } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../context/AuthContext';

export default function Index() {
  const { role } = useAuth();
  const rootNavigationState = useRootNavigationState();

  // Wait for the root navigator to mount before resolving redirect.
  if (!rootNavigationState?.key) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#0000ff" />
      </View>
    );
  }

  if (role === null) return <Redirect href="/login" />;
  if (role === 'staff') return <Redirect href="/(staff)" />;
  return <Redirect href="/(cook)" />;
}