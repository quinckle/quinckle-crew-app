import { Stack } from 'expo-router';
import { View } from 'react-native';
import { QuinckleColors } from '../../constants/Colors';
import { PujaGreeting } from '../../components/ui/PujaGreeting';

export default function CookLayout() {
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
      <PujaGreeting />
    </View>
  );
}
