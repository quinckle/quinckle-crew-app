/**
 * App-wide custom alert system.
 *
 * Replaces native Alert.alert with a styled modal dialog matching
 * the app's dark theme. Accessible imperatively via useAlert() hook.
 *
 * Usage:
 *   const alert = useAlert();
 *   alert.show('Save failed', 'error');          // simple toast-style
 *   alert.show('Password updated.', 'success');
 *   alert.show('Check your connection.', 'info');
 *   alert.confirm('Remove item?', 'This cannot be undone.', onConfirm, { danger: true });
 */

import React, {
  createContext, useContext, useState, useCallback, useRef, useEffect, useMemo,
  type ReactNode,
} from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, Animated, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors, Spacing, Radius, Typography } from '@/constants/Colors';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AlertType = 'info' | 'error' | 'success' | 'warning';

interface AlertState {
  visible: boolean;
  title?: string;
  message: string;
  type: AlertType;
  // Confirm mode
  confirmMode: boolean;
  confirmText: string;
  cancelText: string;
  danger: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface AlertAPI {
  /** Simple one-line alert — disappears on OK tap */
  show(message: string, type?: AlertType, title?: string): void;
  /** Confirmation dialog — Cancel + action button */
  confirm(
    title: string,
    message: string,
    onConfirm: () => void,
    options?: { danger?: boolean; confirmText?: string; cancelText?: string; onCancel?: () => void },
  ): void;
  /** Convenience shorthands */
  error(message: string, title?: string): void;
  success(message: string, title?: string): void;
  info(message: string, title?: string): void;
}

const AlertContext = createContext<AlertAPI | null>(null);

// ── Icon + colour config ──────────────────────────────────────────────────────

const TYPE_CONFIG: Record<AlertType, { icon: React.ComponentProps<typeof Ionicons>['name']; color: string }> = {
  info:    { icon: 'information-circle-outline', color: QuinckleColors.info },
  error:   { icon: 'alert-circle-outline',        color: QuinckleColors.danger },
  success: { icon: 'checkmark-circle-outline',    color: QuinckleColors.success },
  warning: { icon: 'warning-outline',             color: QuinckleColors.warning },
};

// ── Provider ──────────────────────────────────────────────────────────────────

const DEFAULT: AlertState = {
  visible: false, message: '', type: 'info',
  confirmMode: false, confirmText: 'Confirm', cancelText: 'Cancel',
  danger: false,
};

export function AlertProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AlertState>(DEFAULT);
  const scaleAnim = useRef(new Animated.Value(0.92)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (state.visible) {
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 300, friction: 26 }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 160, useNativeDriver: true }),
      ]).start();
    } else {
      scaleAnim.setValue(0.92);
      opacityAnim.setValue(0);
    }
  }, [state.visible, scaleAnim, opacityAnim]);

  const dismiss = useCallback(() => setState(s => ({ ...s, visible: false })), []);

  const show = useCallback<AlertAPI['show']>((message, type = 'info', title) => {
    setState({ ...DEFAULT, visible: true, message, type, title, confirmMode: false });
  }, []);

  const confirm = useCallback<AlertAPI['confirm']>((title, message, onConfirm, opts = {}) => {
    setState({
      ...DEFAULT,
      visible: true,
      title, message, type: opts.danger ? 'error' : 'warning',
      confirmMode: true,
      confirmText: opts.confirmText ?? 'Confirm',
      cancelText:  opts.cancelText  ?? 'Cancel',
      danger:      opts.danger      ?? false,
      onConfirm,
      onCancel: opts.onCancel,
    });
  }, []);

  const error = useCallback<AlertAPI['error']>((message, title) => {
    show(message, 'error', title);
  }, [show]);
  const success = useCallback<AlertAPI['success']>((message, title) => {
    show(message, 'success', title);
  }, [show]);
  const info = useCallback<AlertAPI['info']>((message, title) => {
    show(message, 'info', title);
  }, [show]);

  const api = useMemo<AlertAPI>(
    () => ({ show, confirm, error, success, info }),
    [show, confirm, error, success, info],
  );

  const cfg = TYPE_CONFIG[state.type];

  return (
    <AlertContext.Provider value={api}>
      {children}
      <Modal
        visible={state.visible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={dismiss}
      >
        <Pressable style={s.backdrop} onPress={!state.confirmMode ? dismiss : undefined}>
          <Animated.View style={[s.card, { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }]}>
            {/* Icon */}
            <View style={[s.iconWrap, { backgroundColor: cfg.color + '1A' }]}>
              <Ionicons name={cfg.icon} size={26} color={cfg.color} />
            </View>

            {/* Text */}
            {state.title && <Text style={s.title}>{state.title}</Text>}
            <Text style={s.message}>{state.message}</Text>

            {/* Buttons */}
            {state.confirmMode ? (
              <View style={s.btnRow}>
                <TouchableOpacity
                  style={[s.btn, s.btnCancel]}
                  onPress={() => { state.onCancel?.(); dismiss(); }}
                  activeOpacity={0.7}
                >
                  <Text style={s.btnCancelText}>{state.cancelText}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.btn, s.btnConfirm, state.danger && s.btnDanger]}
                  onPress={() => { dismiss(); setTimeout(() => state.onConfirm?.(), 100); }}
                  activeOpacity={0.8}
                >
                  <Text style={[s.btnConfirmText, state.danger && s.btnDangerText]}>{state.confirmText}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={[s.btn, s.btnOk]} onPress={dismiss} activeOpacity={0.8}>
                <Text style={s.btnOkText}>OK</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        </Pressable>
      </Modal>
    </AlertContext.Provider>
  );
}

export function useAlert(): AlertAPI {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error('useAlert must be used within AlertProvider');
  return ctx;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.xl,
    borderWidth: 0.5,
    borderColor: QuinckleColors.border,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  iconWrap: {
    width: 52, height: 52,
    borderRadius: Radius.xl,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  title: {
    ...Typography.subtitle,
    color: QuinckleColors.textPrimary,
    textAlign: 'center',
  },
  message: {
    ...Typography.body,
    color: QuinckleColors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  btnRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.md,
    alignSelf: 'stretch',
  },
  btn: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCancel: {
    backgroundColor: QuinckleColors.surfaceElevated,
    borderWidth: 0.5, borderColor: QuinckleColors.border,
  },
  btnCancelText: { ...Typography.bodyStrong, color: QuinckleColors.textSecondary },
  btnConfirm: {
    backgroundColor: QuinckleColors.primary,
  },
  btnConfirmText: { ...Typography.bodyStrong, color: '#fff' },
  btnDanger: { backgroundColor: QuinckleColors.danger },
  btnDangerText: { color: '#fff' },
  btnOk: {
    flex: 0,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderWidth: 0.5, borderColor: QuinckleColors.border,
    marginTop: Spacing.md,
    alignSelf: 'stretch',
  },
  btnOkText: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary },
});
