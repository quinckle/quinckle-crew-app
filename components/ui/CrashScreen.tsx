/**
 * Shown in place of the app when a screen throws while it renders.
 *
 * Without it React unmounts the whole tree and the till is left on the app's
 * near-black background with no way out but force-stopping the app — the
 * "black screen" a venue reported. Here the crew sees what happened and has
 * two ways back: try the screen again, or restart the app.
 *
 * Self-contained on purpose: it renders outside AuthProvider and the Stack, so
 * it may use nothing that needs them.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import { DevSettings, Pressable, StyleSheet, Text, View } from 'react-native';
import { QuinckleColors, Radius, Spacing, Typography } from '@/constants/Colors';
import { recordCrash } from '@/services/crashReport';

interface Props {
  error: Error;
  retry: () => Promise<void>;
}

async function restartApp() {
  try {
    if (Updates.isEnabled) await Updates.reloadAsync();
    else DevSettings.reload();
  } catch { /* nothing else to try; the crew can still reopen the app */ }
}

export default function CrashScreen({ error, retry }: Props) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void recordCrash(error, 'render', false);
  }, [error]);

  const onRetry = async () => {
    setBusy(true);
    try { await retry(); } finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <View style={styles.icon}>
          <Ionicons name="warning-outline" size={28} color={QuinckleColors.warning} />
        </View>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          This screen hit an error. Orders already sent are safe on the server.
          Try again, or restart the app if it keeps happening.
        </Text>

        <Pressable
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          onPress={onRetry}
          disabled={busy}
        >
          <Text style={styles.primaryText}>{busy ? 'Trying…' : 'Try again'}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          onPress={restartApp}
        >
          <Text style={styles.secondaryText}>Restart app</Text>
        </Pressable>

        <Text style={styles.detail} numberOfLines={2}>{error.message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxl,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: QuinckleColors.surface,
    borderColor: QuinckleColors.border,
    borderWidth: 1,
    borderRadius: Radius.xl,
    padding: Spacing.xxl,
    alignItems: 'center',
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: QuinckleColors.warningSoft,
    borderColor: QuinckleColors.warningBorder,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  title: { ...Typography.title, color: QuinckleColors.textPrimary, textAlign: 'center' },
  body: {
    ...Typography.body,
    color: QuinckleColors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.md,
    marginBottom: Spacing.xxl,
    lineHeight: 22,
  },
  primary: {
    alignSelf: 'stretch',
    backgroundColor: QuinckleColors.primary,
    borderRadius: Radius.lg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: { ...Typography.bodyStrong, color: '#FFFFFF' },
  secondary: {
    alignSelf: 'stretch',
    borderColor: QuinckleColors.borderStrong,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  secondaryText: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary },
  pressed: { opacity: 0.8 },
  detail: {
    ...Typography.micro,
    color: QuinckleColors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
});
