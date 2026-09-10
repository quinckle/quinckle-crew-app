import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Animated, Easing, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

function shortId(id?: string | null): string {
  return id ? id.replace(/-/g, '').slice(0, 8) : '—';
}

function fmtDate(d?: Date | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

/**
 * Diagnostic + OTA installer. Shows the live channel / runtime / bundle so we
 * can see exactly what the device is running, auto-downloads a newer OTA with
 * an indeterminate "installing" bar, and offers a Restart when one is ready.
 */
export default function UpdateStatus() {
  const {
    currentlyRunning,
    isUpdateAvailable,
    isUpdatePending,
    isChecking,
    isDownloading,
    checkError,
    downloadError,
  } = Updates.useUpdates();

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [trackW, setTrackW] = useState(0);

  const downloading = isDownloading || busy;

  // ── Indeterminate "installing" bar ──────────────────────────────────────────
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!downloading) return;
    const loop = Animated.loop(
      Animated.timing(slide, {
        toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true,
      }),
    );
    loop.start();
    return () => { loop.stop(); slide.setValue(0); };
  }, [downloading, slide]);

  // ── Auto-download a newer update once it's been detected ────────────────────
  useEffect(() => {
    if (isUpdateAvailable && !isUpdatePending && !isDownloading && Updates.isEnabled) {
      setMsg('Installing update…');
      Updates.fetchUpdateAsync().catch(() => {});
    }
  }, [isUpdateAvailable, isUpdatePending, isDownloading]);

  const onCheck = useCallback(async () => {
    if (!Updates.isEnabled) { setMsg('Updates are disabled in this build (dev / Expo Go)'); return; }
    setBusy(true);
    setMsg('Checking…');
    try {
      const res = await Updates.checkForUpdateAsync();
      if (res.isAvailable) {
        setMsg('Installing update…');
        await Updates.fetchUpdateAsync();
      } else {
        setMsg("You're on the latest version");
      }
    } catch (e: any) {
      setMsg(e?.message ?? 'Update check failed');
    } finally {
      setBusy(false);
    }
  }, []);

  const onRestart = useCallback(async () => {
    try { await Updates.reloadAsync(); } catch { /* no-op */ }
  }, []);

  const channel = currentlyRunning?.channel ?? (Updates as any).channel ?? 'none';
  const runtime = currentlyRunning?.runtimeVersion ?? Updates.runtimeVersion ?? '—';
  const isEmbedded = currentlyRunning?.isEmbeddedLaunch;
  const running = isEmbedded ? 'Embedded (built-in)' : `OTA ${shortId(currentlyRunning?.updateId)}`;
  const released = fmtDate(currentlyRunning?.createdAt);
  const err = downloadError || checkError;

  const slideX = slide.interpolate({ inputRange: [0, 1], outputRange: [-trackW * 0.45, trackW] });

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <View style={styles.iconWrap}>
          <Ionicons name="cloud-download-outline" size={18} color="white" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>App Updates</Text>
          <Text style={styles.subtitle}>Channel {channel} · runtime {runtime}</Text>
        </View>
        <TouchableOpacity
          onPress={onCheck}
          disabled={downloading || isChecking}
          style={[styles.checkBtn, (downloading || isChecking) && styles.checkBtnDisabled]}
          activeOpacity={0.7}
        >
          {(downloading || isChecking)
            ? <ActivityIndicator size="small" color={QuinckleColors.primary} />
            : <Text style={styles.checkBtnText}>Check</Text>}
        </TouchableOpacity>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>Running</Text>
        <Text style={styles.metaValue}>{running}</Text>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>Released</Text>
        <Text style={styles.metaValue}>{released}</Text>
      </View>

      {downloading && (
        <View style={styles.progressTrack} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
          <Animated.View style={[styles.progressBar, { width: trackW * 0.45, transform: [{ translateX: slideX }] }]} />
        </View>
      )}

      {isUpdatePending && !downloading && (
        <TouchableOpacity style={styles.restartBtn} onPress={onRestart} activeOpacity={0.85}>
          <Ionicons name="refresh" size={15} color="#fff" />
          <Text style={styles.restartText}>Update ready · Restart now</Text>
        </TouchableOpacity>
      )}

      {!!msg && !downloading && !isUpdatePending && <Text style={styles.msg}>{msg}</Text>}
      {!!err && !downloading && <Text style={styles.errMsg}>{err.message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: QuinckleColors.surfaceMuted,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    padding: 14,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: QuinckleColors.surfaceMutedHover,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '700' },
  subtitle: { color: QuinckleColors.textTertiary, fontSize: 12, marginTop: 1 },
  checkBtn: {
    paddingHorizontal: 14, height: 32, borderRadius: 16,
    backgroundColor: QuinckleColors.surfaceMutedHover,
    alignItems: 'center', justifyContent: 'center', minWidth: 64,
  },
  checkBtnDisabled: { opacity: 0.6 },
  checkBtnText: { color: QuinckleColors.textPrimary, fontSize: 13, fontWeight: '600' },
  metaRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 12,
  },
  metaLabel: { color: QuinckleColors.textTertiary, fontSize: 12 },
  metaValue: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  progressTrack: {
    height: 5, borderRadius: 3, marginTop: 14, overflow: 'hidden',
    backgroundColor: QuinckleColors.surfaceMutedHover,
  },
  progressBar: { height: 5, borderRadius: 3, backgroundColor: QuinckleColors.primary },
  restartBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 14, height: 40, borderRadius: 12, backgroundColor: QuinckleColors.primary,
  },
  restartText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  msg: { color: QuinckleColors.textTertiary, fontSize: 12, marginTop: 12 },
  errMsg: { color: QuinckleColors.danger, fontSize: 12, marginTop: 12 },
});
