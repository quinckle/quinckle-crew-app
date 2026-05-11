import { Stack } from 'expo-router';
import { QuinckleColors } from '../../constants/Colors';

export default function StaffLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        animationDuration: 250,
        gestureEnabled: true,
        gestureDirection: 'horizontal',
        contentStyle: { backgroundColor: QuinckleColors.background },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="[tableId]" />
      <Stack.Screen name="menu" options={{ presentation: 'card' }} />
    </Stack>
  );
}
