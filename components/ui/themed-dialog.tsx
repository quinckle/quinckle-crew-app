import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { QuinckleColors } from '../../constants/Colors';

type ThemedDialogAction = {
  label: string;
  onPress: () => void;
  variant?: 'default' | 'danger';
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
            {actions.map((action) => (
              <Pressable
                key={action.label}
                style={[
                  styles.actionButton,
                  action.variant === 'danger' ? styles.actionDanger : styles.actionDefault,
                ]}
                onPress={action.onPress}
              >
                <Text
                  style={[
                    styles.actionText,
                    action.variant === 'danger' ? styles.actionTextDanger : styles.actionTextDefault,
                  ]}
                >
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    borderRadius: 14,
    padding: 16,
  },
  title: {
    color: QuinckleColors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  message: {
    marginTop: 8,
    color: QuinckleColors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  actionsRow: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
  },
  actionDefault: {
    backgroundColor: QuinckleColors.surfaceHover,
    borderColor: QuinckleColors.border,
  },
  actionDanger: {
    backgroundColor: `${QuinckleColors.danger}20`,
    borderColor: QuinckleColors.danger,
  },
  actionText: {
    fontWeight: '700',
    fontSize: 13,
  },
  actionTextDefault: {
    color: QuinckleColors.textPrimary,
  },
  actionTextDanger: {
    color: QuinckleColors.danger,
  },
});

