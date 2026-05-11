import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

type ThemedDialogAction = {
  label: string;
  onPress: () => void;
  variant?: 'default' | 'danger' | 'primary';
};

type ThemedDialogProps = {
  visible: boolean;
  title: string;
  message: string;
  actions: ThemedDialogAction[];
  onClose: () => void;
};

export function ThemedDialog({ visible, title, message, actions, onClose }: ThemedDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <View style={styles.actionsRow}>
            {actions.map((action) => {
              const variant = action.variant ?? 'default';
              return (
                <Pressable
                  key={action.label}
                  style={[
                    styles.actionButton,
                    variant === 'danger' && styles.actionDanger,
                    variant === 'primary' && styles.actionPrimary,
                    variant === 'default' && styles.actionDefault,
                  ]}
                  onPress={action.onPress}
                >
                  <Text
                    style={[
                      styles.actionText,
                      variant === 'danger' && styles.actionTextDanger,
                      variant === 'primary' && styles.actionTextPrimary,
                      variant === 'default' && styles.actionTextDefault,
                    ]}
                  >
                    {action.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  card: {
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    borderRadius: Radius.xl,
    padding: Spacing.xxl,
  },
  title: {
    ...Typography.subtitle,
    color: QuinckleColors.textPrimary,
  },
  message: {
    marginTop: Spacing.sm,
    ...Typography.body,
    color: QuinckleColors.textSecondary,
    lineHeight: 21,
  },
  actionsRow: {
    marginTop: Spacing.xl,
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  actionButton: {
    flex: 1,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderWidth: 1,
  },
  actionDefault: {
    backgroundColor: QuinckleColors.surfaceMuted,
    borderColor: QuinckleColors.border,
  },
  actionPrimary: {
    backgroundColor: QuinckleColors.primary,
    borderColor: QuinckleColors.primary,
  },
  actionDanger: {
    backgroundColor: QuinckleColors.dangerSoft,
    borderColor: QuinckleColors.dangerBorder,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  actionTextDefault: {
    color: QuinckleColors.textPrimary,
  },
  actionTextPrimary: {
    color: '#fff',
  },
  actionTextDanger: {
    color: QuinckleColors.danger,
  },
});
