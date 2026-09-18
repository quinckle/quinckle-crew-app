import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { QuinckleColors } from '../../constants/Colors';
import { ItemReadyToast } from '../../components/ui/ItemReadyToast';
import { useItemReadyToasts, dismissReady, clearReady } from '../../stores/itemReadyToast';

export default function StaffLayout() {
  const router = useRouter();
  const toasts = useItemReadyToasts();

  // Drop any lingering cards when leaving the staff area (logout / role switch).
  useEffect(() => clearReady, []);

  return (
    // Wrap the navigator so the item-ready cards render as a sibling ABOVE the
    // whole Stack — a card owned by any single screen would be hidden the moment
    // the steward taps into the table-detail screen (a separate native screen,
    // which no z-index inside the first screen can reach past).
    <View style={{ flex: 1, backgroundColor: QuinckleColors.background }}>
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
        {/* Lift-and-fade: the screen grows out of the control that opened it.
            transparentModal keeps the table underneath mounted and visible, so
            the backdrop the screen draws dims the bill you are adjusting rather
            than a blank canvas. The stack only cross-fades; the lift itself is
            an Animated value inside the screen.

            No gesture: this is a form, and a stray swipe that discards a
            half-typed bill is the reason it stopped being a bottom sheet. */}
        <Stack.Screen
          name="adjust-bill"
          options={{
            presentation: 'transparentModal',
            animation: 'fade',
            animationDuration: 200,
            gestureEnabled: false,
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen name="menu" options={{ presentation: 'card' }} />
        <Stack.Screen
          name="more"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
            animationDuration: 220,
            gestureDirection: 'vertical',
            contentStyle: { backgroundColor: QuinckleColors.background },
          }}
        />
        <Stack.Screen name="profile" />
        <Stack.Screen name="cash-ledger" />
        <Stack.Screen name="order-ledger" />
        <Stack.Screen name="order-detail" />
        <Stack.Screen name="delivery" />
      </Stack>

      <ItemReadyToast
        toasts={toasts}
        onDismiss={dismissReady}
        onPress={(t) => {
          dismissReady(t.tableNumber);
          if (t.sessionId) {
            router.push({
              pathname: '/(staff)/[tableId]',
              params: {
                tableId: String(t.tableNumber),
                sessionId: t.sessionId,
                tableDbId: t.tableDbId ?? '',
              },
            });
          } else {
            // Session raced away (served / closed elsewhere) — fall back to the
            // floor grid so staff can pick the table manually.
            router.push('/(staff)');
          }
        }}
      />
    </View>
  );
}
