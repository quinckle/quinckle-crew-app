import { Stack } from 'expo-router';

export default function StaffLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        animationDuration: 250,
        gestureEnabled: true,
        gestureDirection: 'horizontal',
        contentStyle: { backgroundColor: '#050505' },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="[tableId]" />
      <Stack.Screen name="menu" options={{ presentation: 'card' }} />
    </Stack>
  );
}
