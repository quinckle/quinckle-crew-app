import { Stack } from 'expo-router';
import { QuinckleColors } from '../../constants/Colors';

export default function StaffLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        animationDuration: 250,
        animationTypeForReplace: 'push',
        gestureEnabled: true,
        gestureDirection: 'horizontal',
        presentation: 'card',
        contentStyle: {
          backgroundColor: QuinckleColors.background,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          overflow: 'hidden',
        },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="[tableId]" />
      <Stack.Screen name="order-menu" />
      <Stack.Screen name="payment-collect" />
      <Stack.Screen name="menu" options={{ presentation: 'card' }} />
      <Stack.Screen name="profile" />
      <Stack.Screen name="cash-ledger" />
      <Stack.Screen name="order-ledger" />
      <Stack.Screen name="order-detail" />
    </Stack>
  );
}
