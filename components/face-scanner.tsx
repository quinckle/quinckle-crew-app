/**
 * The camera sheet used for both face enrollment and face clock-in.
 *
 * Two modes:
 *
 *  - AUTO (the station): full screen, no button. The person walks up, fills the
 *    oval, and it fires by itself. There is nothing to tap because tapping is
 *    the problem — the shake from a finger on the glass is a real source of the
 *    motion blur that the sharpness gate then rejects, and a queue moves faster
 *    when nobody has to work out what to press.
 *  - MANUAL (enrollment): a deliberate button per capture, because enrollment is
 *    a considered act and the operator is positioning someone on purpose.
 *
 * Kiosk rules carried over from the attendance station: guidance is shown inline
 * and never as an Alert, because an Alert on an unattended tablet blocks the
 * queue until somebody dismisses it. Every failure is recoverable by standing
 * still, and the caller always keeps the PIN.
 *
 * The preview is mirrored (`scaleX: -1`) so people see themselves the way a
 * mirror shows them. Only the PREVIEW is flipped — the captured photo is not,
 * which matters because a horizontally flipped face produces a different
 * embedding, and enrolling flipped while matching unflipped would fail forever.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing } from '../constants/Colors';
import {
  embedFace,
  loadFaceModel,
  FACE_ERROR_TEXT,
  type FaceError,
  type LivenessTelemetry,
} from '../services/face';

/** Frames tried per manual tap before giving up. */
const ATTEMPTS = 3;

/**
 * How long the auto loop keeps looking before offering the PIN.
 *
 * Long enough for someone to arrive, take their hat off and settle; short
 * enough that a person the camera simply cannot read is not left standing there.
 */
const AUTO_TIMEOUT_MS = 20000;

/** Breathing room between auto attempts, so the preview is not starved. */
const AUTO_GAP_MS = 350;

interface Props {
  visible: boolean;
  title: string;
  subtitle?: string;
  /** Label on the capture button — ignored in auto mode, which has no button. */
  actionLabel?: string;
  /** Fire by itself as soon as a usable face appears. The station wants this. */
  auto?: boolean;
  busy?: boolean;
  onClose: () => void;
  /**
   * `liveness` is optional and absent when the check could not run — callers
   * forward it to the server as telemetry and must not treat its absence as a
   * failed capture.
   */
  onEmbedding: (embedding: number[], quality: number, liveness?: LivenessTelemetry) => void;
}

export default function FaceScanner({
  visible,
  title,
  subtitle,
  actionLabel = 'Scan face',
  auto = false,
  busy = false,
  onClose,
  onEmbedding,
}: Props) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [working, setWorking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  /** Bumped by "Try again" — a ref alone cannot restart the auto effect. */
  const [runId, setRunId] = useState(0);

  // `visible` in a ref as well, so the auto loop can see it change. Reading the
  // prop inside the loop would capture the value from the render that started
  // it, and the loop would carry on shooting after the sheet closed.
  const liveRef = useRef(false);

  useEffect(() => {
    liveRef.current = visible;
    if (visible) {
      setHint(null);
      setGaveUp(false);
      setRunId(0);
      // Warm the interpreter while the person is still walking up. A cold load
      // on the first capture reads as the app hanging.
      loadFaceModel().catch(() => {});
    } else {
      setWorking(false);
    }
    return () => {
      liveRef.current = false;
    };
  }, [visible]);

  /** One capture → embedding. Returns the failure so callers can guide. */
  const attempt = useCallback(async (): Promise<
    | { ok: true; embedding: number[]; quality: number; liveness?: LivenessTelemetry }
    | { ok: false; error: FaceError | null }
  > => {
    const cam = cameraRef.current;
    if (!cam) return { ok: false, error: null };

    const photo = await cam.takePictureAsync({
      quality: 1,
      skipProcessing: false,
      shutterSound: false,
    });
    if (!photo?.uri || !photo.width || !photo.height) return { ok: false, error: null };

    const res = await embedFace(photo);
    if (res.ok) {
      return { ok: true, embedding: res.embedding, quality: res.quality, liveness: res.liveness };
    }

    console.warn(`[face] ${res.error}${res.detail ? `: ${res.detail}` : ''}`);
    return { ok: false, error: res.error };
  }, []);

  const succeed = useCallback(
    (embedding: number[], quality: number, liveness?: LivenessTelemetry) => {
      playChime();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onEmbedding(embedding, quality, liveness);
    },
    [onEmbedding],
  );

  // ── Auto mode ───────────────────────────────────────────────────────────────
  //
  // Keeps shooting until something works, the sheet closes, or the deadline
  // passes. The guidance text is driven by the SAME error codes the pipeline
  // already produces, so "move closer" appears because the detector actually
  // said the face was too small — not because of a separate heuristic that
  // could drift out of agreement with it.
  useEffect(() => {
    if (!visible || !auto || busy) return;
    let cancelled = false;
    const deadline = Date.now() + AUTO_TIMEOUT_MS;

    (async () => {
      while (!cancelled && liveRef.current && Date.now() < deadline) {
        setWorking(true);
        let res;
        try {
          res = await attempt();
        } catch (e: any) {
          console.warn('[face] auto attempt threw:', String(e?.message ?? e));
          res = { ok: false as const, error: null };
        }
        if (cancelled || !liveRef.current) return;

        if (res.ok) {
          setWorking(false);
          succeed(res.embedding, res.quality, res.liveness);
          return;
        }

        setHint(res.error ? FACE_ERROR_TEXT[res.error] : null);
        setWorking(false);
        await new Promise((r) => setTimeout(r, AUTO_GAP_MS));
      }

      if (!cancelled && liveRef.current) {
        setGaveUp(true);
        setHint(null);
        playThud();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, auto, busy, runId, attempt, succeed]);

  // ── Manual mode ─────────────────────────────────────────────────────────────
  const captureManually = useCallback(async () => {
    if (working || busy) return;
    setWorking(true);
    setHint(null);

    let lastError: FaceError | null = null;
    try {
      for (let i = 0; i < ATTEMPTS; i++) {
        const res = await attempt();
        if (res.ok) {
          succeed(res.embedding, res.quality, res.liveness);
          return;
        }
        lastError = res.error;
        // No point re-shooting what a second frame cannot change.
        if (res.error === 'INFERENCE_FAILED' || res.error === 'DECODE_FAILED') break;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      playThud();
      setHint(lastError ? FACE_ERROR_TEXT[lastError] : 'Could not read that. Use your PIN instead.');
    } catch (e: any) {
      console.warn('[face] capture threw:', String(e?.message ?? e));
      setHint('Could not read that. Use your PIN instead.');
    } finally {
      setWorking(false);
    }
  }, [working, busy, attempt, succeed]);

  const retry = () => {
    setGaveUp(false);
    setHint(null);
    liveRef.current = true;
    // Restarts the auto loop. It is a dependency of that effect precisely so
    // this works — mutating the ref would not re-run anything.
    setRunId((n) => n + 1);
  };

  const pending = working || busy;
  const showCamera = permission?.granted;

  return (
    <Modal visible={visible} transparent={!auto} animationType="fade" onRequestClose={onClose}>
      <View style={auto ? styles.fullBackdrop : styles.backdrop}>
        <View style={[auto ? styles.fullSheet : styles.sheet, auto && { paddingTop: insets.top + Spacing.lg }]}>
          <Text style={auto ? styles.titleLarge : styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

          <View style={auto ? styles.viewportLarge : styles.viewport}>
            {!permission ? (
              <View style={styles.center}>
                <ActivityIndicator color={QuinckleColors.primary} />
              </View>
            ) : !showCamera ? (
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
                <View pointerEvents="none" style={[styles.oval, pending && styles.ovalActive]} />
              </>
            )}
          </View>

          {gaveUp ? (
            <View style={styles.resultBox}>
              <Ionicons name="alert-circle-outline" size={20} color={QuinckleColors.warning} />
              <Text style={styles.resultText}>
                Could not recognise you. Tap your name below and use your PIN.
              </Text>
            </View>
          ) : hint ? (
            <Text style={styles.hint}>{hint}</Text>
          ) : auto ? (
            <Text style={styles.hint}>
              {pending ? 'Looking…' : 'Fit your face inside the circle'}
            </Text>
          ) : null}

          {auto ? (
            gaveUp ? (
              <TouchableOpacity style={styles.action} onPress={retry}>
                <Text style={styles.actionText}>Try again</Text>
              </TouchableOpacity>
            ) : null
          ) : (
            <TouchableOpacity
              style={[styles.action, (pending || !showCamera) && styles.actionDisabled]}
              onPress={captureManually}
              disabled={pending || !showCamera}
            >
              {pending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.actionText}>{actionLabel}</Text>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.cancel, auto && { marginBottom: insets.bottom + Spacing.md }]}
            onPress={onClose}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Sound ─────────────────────────────────────────────────────────────────────
//
// Reuses the existing notification assets rather than inventing new ones — the
// point is that success and failure sound DIFFERENT from across the room, which
// two distinguishable existing chimes already achieve. Every call is best-effort:
// a kiosk with no audio route must still clock people in.

let chime: Audio.Sound | null = null;
let thud: Audio.Sound | null = null;

async function play(which: 'chime' | 'thud') {
  try {
    if (which === 'chime') {
      if (!chime) {
        const { sound } = await Audio.Sound.createAsync(
          require('../assets/audio/notifications/item-ready.wav'),
        );
        chime = sound;
      }
      await chime.replayAsync();
    } else {
      if (!thud) {
        const { sound } = await Audio.Sound.createAsync(
          require('../assets/audio/notifications/kitchen notification.wav'),
        );
        thud = sound;
      }
      await thud.replayAsync();
    }
  } catch {
    /* audio is a nicety, never a requirement */
  }
}

const playChime = () => void play('chime');
const playThud = () => void play('thud');

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const VIEWPORT = 260;
/** Fills the screen while leaving room for the title and the cancel affordance. */
const VIEWPORT_LARGE = Math.min(SCREEN_W - Spacing.lg * 2, SCREEN_H * 0.52);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  fullBackdrop: { flex: 1, backgroundColor: QuinckleColors.background },
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
  fullSheet: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    backgroundColor: QuinckleColors.background,
  },
  title: { fontSize: 19, fontWeight: '700', color: QuinckleColors.textPrimary },
  titleLarge: {
    fontSize: 30,
    fontWeight: '700',
    color: QuinckleColors.textPrimary,
    letterSpacing: -0.6,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13.5,
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
  viewportLarge: {
    width: VIEWPORT_LARGE,
    height: VIEWPORT_LARGE,
    marginTop: Spacing.xl,
    borderRadius: VIEWPORT_LARGE / 2,
    overflow: 'hidden',
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  // Mirrored preview only — see the header note.
  camera: { flex: 1, transform: [{ scaleX: -1 }] },
  oval: {
    position: 'absolute',
    top: '8%',
    left: '16%',
    right: '16%',
    bottom: '8%',
    borderRadius: 9999,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  ovalActive: { borderColor: QuinckleColors.primary, borderWidth: 3 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: Spacing.lg,
  },
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
    marginTop: Spacing.lg,
    fontSize: 15,
    fontWeight: '600',
    color: QuinckleColors.textSecondary,
    textAlign: 'center',
    minHeight: 22,
  },
  resultBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surfaceElevated,
  },
  resultText: { flex: 1, fontSize: 13.5, color: QuinckleColors.textPrimary },
  action: {
    marginTop: Spacing.lg,
    minWidth: 220,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.primary,
  },
  actionDisabled: { opacity: 0.4 },
  actionText: { fontSize: 15.5, fontWeight: '700', color: '#fff' },
  cancel: { marginTop: Spacing.md, paddingVertical: Spacing.sm },
  cancelText: { fontSize: 13.5, color: QuinckleColors.textSecondary },
});
