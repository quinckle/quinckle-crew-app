/**
 * The camera sheet used for both face enrollment and face clock-in.
 *
 * Kiosk rules carried over from the attendance station: errors are shown inline
 * and never as an Alert, because an Alert on an unattended tablet blocks the
 * queue until somebody dismisses it. Every failure here is recoverable by
 * standing still and tapping again, and the caller always keeps the PIN.
 *
 * The preview is mirrored (`scaleX: -1`) so people see themselves the way a
 * mirror shows them. Only the PREVIEW is flipped — the captured photo is not,
 * which matters because a horizontally flipped face produces a different
 * embedding, and enrolling flipped while matching unflipped would fail forever.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { QuinckleColors, Radius, Spacing } from '../constants/Colors';
import { embedFace, loadFaceModel, FACE_ERROR_TEXT } from '../services/face';

interface Props {
  visible: boolean;
  title: string;
  subtitle?: string;
  /** Label on the capture button — "Clock in" reads better than "Capture". */
  actionLabel?: string;
  busy?: boolean;
  onClose: () => void;
  onEmbedding: (embedding: number[], quality: number) => void;
}

export default function FaceScanner({
  visible,
  title,
  subtitle,
  actionLabel = 'Scan face',
  busy = false,
  onClose,
  onEmbedding,
}: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [working, setWorking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  // Warm the interpreter while the person is still walking up. A cold load on
  // the first capture reads as the app hanging.
  useEffect(() => {
    if (visible) loadFaceModel().catch(() => {});
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      setHint(null);
      setWorking(false);
    }
  }, [visible]);

  const capture = useCallback(async () => {
    if (!cameraRef.current || working || busy) return;
    setWorking(true);
    setHint(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        skipProcessing: false,
        shutterSound: false,
      });
      if (!photo?.uri || !photo.width || !photo.height) {
        setHint('Could not take the photo. Try again.');
        return;
      }

      const res = await embedFace(photo);
      if (!res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        // The stage and its detail go to the log, never to the person queuing —
        // they get the actionable sentence. `adb logcat -s ReactNativeJS` is
        // what turns "it didn't work" into a specific failing stage.
        if (res.detail) console.warn(`[face] ${res.error}: ${res.detail}`);
        else console.warn(`[face] ${res.error}`);
        setHint(FACE_ERROR_TEXT[res.error]);
        return;
      }

      Haptics.selectionAsync().catch(() => {});
      onEmbedding(res.embedding, res.quality);
    } catch (e: any) {
      console.warn('[face] capture threw:', String(e?.message ?? e));
      setHint('Could not read that. Use your PIN instead.');
    } finally {
      setWorking(false);
    }
  }, [working, busy, onEmbedding]);

  const pending = working || busy;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

          <View style={styles.viewport}>
            {!permission ? (
              <View style={styles.center}>
                <ActivityIndicator color={QuinckleColors.primary} />
              </View>
            ) : !permission.granted ? (
              <View style={styles.center}>
                <Ionicons name="camera-outline" size={28} color={QuinckleColors.textTertiary} />
                <Text style={styles.permText}>
                  The station needs the camera to check people in by face.
                </Text>
                <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
                  <Text style={styles.permBtnText}>Allow camera</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <CameraView
                  ref={cameraRef}
                  style={styles.camera}
                  facing="front"
                  animateShutter={false}
                />
                {/* Guide only. The crop comes from MLKit's detected box, not
                    from this oval — it is here to get people centred and at a
                    sensible distance, nothing more. */}
                <View pointerEvents="none" style={styles.oval} />
              </>
            )}
          </View>

          {hint ? <Text style={styles.hint}>{hint}</Text> : null}

          <TouchableOpacity
            style={[styles.action, (pending || !permission?.granted) && styles.actionDisabled]}
            onPress={capture}
            disabled={pending || !permission?.granted}
          >
            {pending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.actionText}>{actionLabel}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancel} onPress={onClose} disabled={working}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const VIEWPORT = 260;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    padding: Spacing.xl,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surface,
  },
  title: { fontSize: 19, fontWeight: '700', color: QuinckleColors.textPrimary },
  subtitle: {
    marginTop: 2,
    fontSize: 12.5,
    color: QuinckleColors.textSecondary,
    textAlign: 'center',
  },
  viewport: {
    width: VIEWPORT,
    height: VIEWPORT,
    marginTop: Spacing.lg,
    borderRadius: VIEWPORT / 2,
    overflow: 'hidden',
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  // Mirrored preview only — see the header note.
  camera: { flex: 1, transform: [{ scaleX: -1 }] },
  oval: {
    position: 'absolute',
    top: 22,
    left: 42,
    right: 42,
    bottom: 22,
    borderRadius: VIEWPORT / 2,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.lg },
  permText: { fontSize: 12.5, color: QuinckleColors.textSecondary, textAlign: 'center' },
  permBtn: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  permBtnText: { fontSize: 13, fontWeight: '600', color: QuinckleColors.textPrimary },
  hint: {
    marginTop: Spacing.md,
    fontSize: 12.5,
    color: QuinckleColors.warning,
    textAlign: 'center',
  },
  action: {
    marginTop: Spacing.lg,
    width: '100%',
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.primary,
  },
  actionDisabled: { opacity: 0.4 },
  actionText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  cancel: { marginTop: Spacing.md, paddingVertical: Spacing.sm },
  cancelText: { fontSize: 13.5, color: QuinckleColors.textSecondary },
});
