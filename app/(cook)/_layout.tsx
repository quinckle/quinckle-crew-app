import { Stack } from 'expo-router';
import { View } from 'react-native';
import { QuinckleColors } from '../../constants/Colors';
import { PujaGreeting } from '../../components/ui/PujaGreeting';
import { OffShiftPill } from '../../components/ui/OffShiftPill';
import { useAuth } from '../../context/AuthContext';
import { useOffShiftSync } from '../../hooks/useOffShiftSync';

export default function CookLayout() {
  const { staffInfo } = useAuth();
  // Off shift: mute this phone while its staffer is clocked out (stores/offShift).
  useOffShiftSync(staffInfo?.restaurantId ? `kitchen:${staffInfo.restaurantId}` : null);
  return (
    // Wrapped so the one-time Puja greeting can sit above the whole Stack.
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
        <Stack.Screen name="profile" />
      </Stack>
      <OffShiftPill />
      <PujaGreeting />
    </View>
  );
}
