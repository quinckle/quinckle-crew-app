/**
 * Printer Pairing Screen (KOT_PRINTER_PLAN.md Phase 6)
 *
 * Accessible from both staff and cook profile pages.
 * Handles: scan BT devices, pair, unpair, test print, status display.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { QuinckleColors, Radius, Spacing } from '../constants/Colors';
import { ThemedDialog } from '../components/ui/themed-dialog';
import {
  scan,
  pair,
  pairNetwork,
  unpair,
  printTest,
  getStatus,
  getConfig,
  isUpiQrEnabled,
  setUpiQrEnabled,
  type BluetoothDevice,
  type PrinterStatus,
} from '../services/printer';
import { PAPER_PRESETS } from '../services/paperProfile';
import { printerApi } from '../services/api';
import { useAuth } from '../context/AuthContext';

export default function PrinterScreen() {
  const insets = useSafeAreaInsets();
  const { staffInfo } = useAuth();

  const [localStatus, setLocalStatus] = useState<PrinterStatus>(getStatus());
  const [config, setConfig] = useState(getConfig());
  const [serverStatus, setServerStatus] = useState<{
    printerName: string | null;
    paired: boolean;
    pairedByName: string | null;
    pairedById: string | null;
    kitchenMode: string;
    kotAutoPrint?: boolean;
  } | null>(null);
  const [kotAutoPrint, setKotAutoPrint] = useState(true);
  const [autoPrintSaving, setAutoPrintSaving] = useState(false);

  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<BluetoothDevice | null>(null);
  const [isPairing, setIsPairing] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isUnpairing, setIsUnpairing] = useState(false);
  const [showScanView, setShowScanView] = useState(false);
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(null);
  const [upiQr, setUpiQr] = useState(isUpiQrEnabled());

  // Network (LAN/WiFi) printer entry
  const [showNetworkForm, setShowNetworkForm] = useState(false);
  const [networkIp, setNetworkIp] = useState('');
  const [networkPort, setNetworkPort] = useState('9100');

  const handleUpiQrToggle = useCallback((next: boolean) => {
    setUpiQr(next);
    Haptics.selectionAsync();
    void setUpiQrEnabled(next);
  }, []);

  const [dialog, setDialog] = useState<{
    visible: boolean; title: string; message: string;
    actions: Array<{ label: string; variant?: 'default' | 'danger' | 'primary'; onPress: () => void }>;
  }>({ visible: false, title: '', message: '', actions: [] });

  // ── Load server status on mount ────────────────────────────────────────────

  const loadServerStatus = useCallback(async () => {
    try {
      const res = await printerApi.getStatus();
      setServerStatus(res.data);
      if (typeof res.data?.kotAutoPrint === 'boolean') {
        setKotAutoPrint(res.data.kotAutoPrint);
      }
    } catch { /* non-fatal */ }
  }, []);

  const handleAutoPrintToggle = async () => {
    if (autoPrintSaving) return;
    const next = !kotAutoPrint;
    setKotAutoPrint(next);
    setAutoPrintSaving(true);
    try {
      await printerApi.setAutoPrint(next);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      setKotAutoPrint(!next); // revert on failure
      showToast('Could not update auto-print setting', false);
    } finally {
      setAutoPrintSaving(false);
    }
  };

  useEffect(() => {
    loadServerStatus();
    setLocalStatus(getStatus());
    setConfig(getConfig());
  }, [loadServerStatus]);

  // ── Toast helper ───────────────────────────────────────────────────────────

  function showToast(message: string, ok: boolean) {
    setToast({ message, ok });
    setTimeout(() => setToast(null), 3000);
  }

  // ── Scan ───────────────────────────────────────────────────────────────────

  async function handleScan() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsScanning(true);
    setDevices([]);
    setShowScanView(true);
    try {
      const found = await scan();
      setDevices(found);
      if (found.length === 0) showToast('No Bluetooth devices found. Make sure the printer is on and paired in Android Settings.', false);
    } catch (err: any) {
      if (err?.message === 'BLUETOOTH_PERMISSION_DENIED') {
        showToast('Bluetooth permission denied. Go to Settings → App Permissions and allow Nearby Devices.', false);
      } else {
        showToast('Bluetooth scan failed. Make sure Bluetooth is on and try again.', false);
      }
    } finally {
      setIsScanning(false);
    }
  }

  // ── Paper width picker ───────────────────────────────────────────────────────
  // Opens the themed dialog with the standard roll widths; invokes `onPick` with
  // the chosen width in mm. Used by both the Bluetooth and network pairing flows.

  function chooseWidth(onPick: (widthMM: number) => void) {
    setDialog({
      visible: true,
      title: 'Paper width',
      message: "Select the printer's paper roll width.",
      actions: [
        ...PAPER_PRESETS.map((p) => ({
          label: p.label,
          onPress: () => {
            setDialog((d) => ({ ...d, visible: false }));
            onPick(p.widthMM);
          },
        })),
        { label: 'Cancel', onPress: () => setDialog((d) => ({ ...d, visible: false })) },
      ],
    });
  }

  // ── Pair (Bluetooth) ─────────────────────────────────────────────────────────

  function handlePair(device: BluetoothDevice) {
    // Ask for the paper width first, then pair — fixes the old always-58mm bug.
    chooseWidth((width) => void doPairBluetooth(device, width));
  }

  async function doPairBluetooth(device: BluetoothDevice, width: number) {
    if (!staffInfo?.id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedDevice(device);
    setIsPairing(true);
    try {
      await pair(device, width);
      // Also register on backend
      await printerApi.setPairing({
        pairedTo: staffInfo.id,
        name: device.name,
        address: device.address,
        paperWidth: width,
      });
      setLocalStatus(getStatus());
      setConfig(getConfig());
      await loadServerStatus();
      setShowScanView(false);
      showToast(`Paired with ${device.name} · ${width}mm`, true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      showToast(`Failed to pair with ${device.name}`, false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsPairing(false);
      setSelectedDevice(null);
    }
  }

  // ── Pair (Network / LAN) ──────────────────────────────────────────────────────

  function handlePairNetwork() {
    const ip = networkIp.trim();
    if (!ip) {
      showToast('Enter the printer IP address', false);
      return;
    }
    chooseWidth((width) => void doPairNetwork(ip, width));
  }

  async function doPairNetwork(ip: string, width: number) {
    if (!staffInfo?.id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const port = parseInt(networkPort, 10) || 9100;
    const name = `Network printer (${ip})`;
    setIsPairing(true);
    try {
      await pairNetwork({ ip, port, name }, width);
      await printerApi.setPairing({
        pairedTo: staffInfo.id,
        name,
        address: `tcp://${ip}:${port}`,
        paperWidth: width,
      });
      setLocalStatus(getStatus());
      setConfig(getConfig());
      await loadServerStatus();
      setShowScanView(false);
      setShowNetworkForm(false);
      showToast(`Paired with ${name} · ${width}mm`, true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      showToast('Failed to reach the network printer. Check the IP and that it is on the same WiFi.', false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsPairing(false);
    }
  }

  // ── Unpair ─────────────────────────────────────────────────────────────────

  function confirmUnpair() {
    setDialog({
      visible: true,
      title: 'Unpair Printer',
      message: 'This will disconnect the printer from your phone. You can re-pair at any time.',
      actions: [
        { label: 'Cancel', onPress: () => setDialog((d) => ({ ...d, visible: false })) },
        {
          label: 'Unpair', variant: 'danger', onPress: async () => {
            setDialog((d) => ({ ...d, visible: false }));
            setIsUnpairing(true);
            try {
              await unpair();
              await printerApi.setPairing({ pairedTo: null });
              setLocalStatus('unpaired');
              setConfig(null);
              await loadServerStatus();
              showToast('Printer unpaired', true);
            } catch {
              showToast('Failed to unpair', false);
            } finally {
              setIsUnpairing(false);
            }
          }
        },
      ],
    });
  }

  // ── Test print ─────────────────────────────────────────────────────────────

  async function handleTestPrint() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsTesting(true);
    try {
      const result = await printTest();
      if (result === 'printed') {
        showToast('Test page printed!', true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        showToast('Print failed — check printer connection', false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setIsTesting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const isPairedLocally = localStatus === 'connected' || localStatus === 'disconnected';
  const serverPairedBySomeoneElse = serverStatus?.paired && serverStatus?.pairedById !== staffInfo?.id;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Printer</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        {/* Status card */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>PRINTER STATUS</Text>

          <View style={styles.statusRow}>
            <View style={[
              styles.statusDot,
              localStatus === 'connected' ? styles.dotGreen
                : localStatus === 'disconnected' ? styles.dotYellow
                  : styles.dotGrey,
            ]} />
            <View style={{ flex: 1 }}>
              {isPairedLocally && config ? (
                <>
                  <Text style={styles.statusName}>{config.name}</Text>
                  <Text style={styles.statusSub}>
                    {localStatus === 'connected'
                      ? `Connected · ${config.paperWidth}mm${config.transport === 'network' ? ' · Network' : ''}`
                      : 'Disconnected — tap re-pair to reconnect'}
                  </Text>
                </>
              ) : serverStatus?.paired ? (
                <>
                  <Text style={styles.statusName}>{serverStatus.printerName ?? 'Printer'}</Text>
                  <Text style={styles.statusSub}>
                    Paired by {serverStatus.pairedByName ?? 'another device'} · tap below to take over
                  </Text>
                </>
              ) : (
                <Text style={styles.statusName}>No printer paired</Text>
              )}
            </View>
          </View>

          {/* Auto-print toggle */}
          <View style={styles.autoPrintRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.autoPrintLabel}>Auto-print KOT</Text>
              <Text style={styles.autoPrintSub}>Print automatically on every new order</Text>
            </View>
            <TouchableOpacity
              onPress={handleAutoPrintToggle}
              disabled={autoPrintSaving}
              activeOpacity={0.8}
              style={[styles.toggleTrack, kotAutoPrint && styles.toggleTrackOn]}
            >
              <View style={[styles.toggleThumb, kotAutoPrint && styles.toggleThumbOn]} />
            </TouchableOpacity>
          </View>

          {/* UPI scan-to-pay QR on bills */}
          <View style={styles.autoPrintRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.autoPrintLabel}>Print UPI QR on bills</Text>
              <Text style={styles.autoPrintSub}>Scan-to-pay QR with the exact amount on unpaid bills</Text>
            </View>
            <TouchableOpacity
              onPress={() => handleUpiQrToggle(!upiQr)}
              activeOpacity={0.8}
              style={[styles.toggleTrack, upiQr && styles.toggleTrackOn]}
            >
              <View style={[styles.toggleThumb, upiQr && styles.toggleThumbOn]} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Actions */}
        {isPairedLocally && (
          <View style={styles.actionsCard}>
            <TouchableOpacity
              style={[styles.actionBtn, isTesting && styles.actionBtnDisabled]}
              onPress={handleTestPrint}
              disabled={isTesting}
              activeOpacity={0.75}
            >
              {isTesting
                ? <ActivityIndicator size="small" color={QuinckleColors.primary} />
                : <Ionicons name="print-outline" size={18} color={QuinckleColors.primary} />
              }
              <Text style={styles.actionBtnText}>Print test page</Text>
            </TouchableOpacity>

            <View style={styles.actionDivider} />

            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnSecondary]}
              onPress={handleScan}
              activeOpacity={0.75}
            >
              <Ionicons name="bluetooth" size={18} color={QuinckleColors.textPrimary} />
              <Text style={[styles.actionBtnText, { color: QuinckleColors.textPrimary }]}>Re-pair printer</Text>
            </TouchableOpacity>

            <View style={styles.actionDivider} />

            <TouchableOpacity
              style={[styles.actionBtn, isUnpairing && styles.actionBtnDisabled]}
              onPress={confirmUnpair}
              disabled={isUnpairing}
              activeOpacity={0.75}
            >
              {isUnpairing
                ? <ActivityIndicator size="small" color={QuinckleColors.danger} />
                : <Ionicons name="trash-outline" size={18} color={QuinckleColors.danger} />
              }
              <Text style={[styles.actionBtnText, { color: QuinckleColors.danger }]}>Unpair</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Pair button for unpaired device */}
        {!isPairedLocally && !showScanView && (
          <TouchableOpacity
            style={styles.pairCta}
            onPress={handleScan}
            activeOpacity={0.8}
          >
            <Ionicons name="bluetooth" size={20} color="#fff" />
            <Text style={styles.pairCtaText}>
              {serverPairedBySomeoneElse ? 'Pair printer (take over)' : 'Pair Printer'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Device scan list */}
        {showScanView && (
          <View style={styles.scanCard}>
            <View style={styles.scanHeader}>
              <Text style={styles.sectionLabel}>NEARBY BLUETOOTH DEVICES</Text>
              {isScanning && <ActivityIndicator size="small" color={QuinckleColors.primary} />}
            </View>

            {devices.length === 0 && !isScanning && (
              <Text style={styles.emptyText}>No devices found. Ensure printer is powered on.</Text>
            )}

            {devices.map((device) => (
              <TouchableOpacity
                key={device.address}
                style={[styles.deviceRow, isPairing && selectedDevice?.address === device.address && styles.deviceRowLoading]}
                onPress={() => handlePair(device)}
                disabled={isPairing}
                activeOpacity={0.75}
              >
                <Ionicons name="print-outline" size={20} color={QuinckleColors.textSecondary} />
                <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                  <Text style={styles.deviceName}>{device.name}</Text>
                  <Text style={styles.deviceAddress}>{device.address}</Text>
                </View>
                {isPairing && selectedDevice?.address === device.address
                  ? <ActivityIndicator size="small" color={QuinckleColors.primary} />
                  : <Ionicons name="chevron-forward" size={16} color={QuinckleColors.textTertiary} />
                }
              </TouchableOpacity>
            ))}

            {!isScanning && (
              <TouchableOpacity style={styles.rescanBtn} onPress={handleScan} activeOpacity={0.7}>
                <Ionicons name="refresh-outline" size={15} color={QuinckleColors.primary} />
                <Text style={styles.rescanText}>Scan again</Text>
              </TouchableOpacity>
            )}

            {/* Network / WiFi printer entry */}
            <View style={styles.netDivider} />
            {!showNetworkForm ? (
              <TouchableOpacity style={styles.rescanBtn} onPress={() => setShowNetworkForm(true)} activeOpacity={0.7}>
                <Ionicons name="wifi-outline" size={15} color={QuinckleColors.primary} />
                <Text style={styles.rescanText}>Add a network / WiFi printer</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.netForm}>
                <Text style={styles.netLabel}>NETWORK PRINTER (LAN / WiFi)</Text>
                <TextInput
                  style={styles.netInput}
                  placeholder="Printer IP (e.g. 192.168.1.50)"
                  placeholderTextColor={QuinckleColors.textTertiary}
                  value={networkIp}
                  onChangeText={setNetworkIp}
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TextInput
                  style={styles.netInput}
                  placeholder="Port (default 9100)"
                  placeholderTextColor={QuinckleColors.textTertiary}
                  value={networkPort}
                  onChangeText={setNetworkPort}
                  keyboardType="number-pad"
                />
                <TouchableOpacity
                  style={[styles.netConnectBtn, isPairing && styles.actionBtnDisabled]}
                  onPress={handlePairNetwork}
                  disabled={isPairing}
                  activeOpacity={0.85}
                >
                  {isPairing
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Ionicons name="print-outline" size={16} color="#fff" />}
                  <Text style={styles.netConnectText}>Connect network printer</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Toast */}
      {toast && (
        <View style={[styles.toast, toast.ok ? styles.toastOk : styles.toastErr]}>
          <Ionicons name={toast.ok ? 'checkmark-circle' : 'alert-circle'} size={16} color="#fff" />
          <Text style={styles.toastText}>{toast.message}</Text>
        </View>
      )}

      <ThemedDialog
        visible={dialog.visible}
        title={dialog.title}
        message={dialog.message}
        actions={dialog.actions}
        onClose={() => setDialog((d) => ({ ...d, visible: false }))}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: QuinckleColors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: QuinckleColors.border,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: QuinckleColors.textPrimary },
  scroll: { flex: 1 },

  card: {
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: QuinckleColors.textTertiary,
    marginBottom: Spacing.md,
  },
  statusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  dotGreen: { backgroundColor: QuinckleColors.success },
  dotYellow: { backgroundColor: QuinckleColors.warning },
  dotGrey: { backgroundColor: QuinckleColors.border },
  statusName: { fontSize: 15, fontWeight: '600', color: QuinckleColors.textPrimary },
  statusSub: { fontSize: 12, color: QuinckleColors.textSecondary, marginTop: 2 },
  modeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: Spacing.md,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  modeBadgeText: { fontSize: 11, color: QuinckleColors.textSecondary },

  autoPrintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.border,
  },
  autoPrintLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: QuinckleColors.textPrimary,
  },
  autoPrintSub: {
    fontSize: 11,
    color: QuinckleColors.textTertiary,
    marginTop: 2,
  },
  toggleTrack: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: QuinckleColors.borderStrong,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleTrackOn: { backgroundColor: QuinckleColors.primary },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  toggleThumbOn: { alignSelf: 'flex-end' },

  actionsCard: {
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    overflow: 'hidden',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
  },
  actionBtnSecondary: {},
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnText: { fontSize: 15, color: QuinckleColors.primary, fontWeight: '500' },
  actionDivider: { height: 1, backgroundColor: QuinckleColors.border, marginLeft: Spacing.lg },

  pairCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: QuinckleColors.primary,
    borderRadius: Radius.pill,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    paddingVertical: 15,
  },
  pairCtaText: { fontSize: 16, fontWeight: '600', color: '#fff' },

  scanCard: {
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    overflow: 'hidden',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  scanHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: Spacing.sm },
  emptyText: { color: QuinckleColors.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: Spacing.lg },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.border,
  },
  deviceRowLoading: { opacity: 0.7 },
  deviceName: { fontSize: 14, fontWeight: '600', color: QuinckleColors.textPrimary },
  deviceAddress: { fontSize: 11, color: QuinckleColors.textTertiary, marginTop: 1 },
  rescanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    justifyContent: 'center',
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  rescanText: { fontSize: 13, color: QuinckleColors.primary },

  netDivider: { height: 1, backgroundColor: QuinckleColors.border, marginTop: Spacing.sm },
  netForm: { paddingTop: Spacing.md, gap: Spacing.sm },
  netLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: QuinckleColors.textTertiary,
  },
  netInput: {
    backgroundColor: QuinckleColors.surfaceMuted,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: QuinckleColors.textPrimary,
  },
  netConnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: QuinckleColors.primary,
    borderRadius: Radius.pill,
    paddingVertical: 12,
    marginTop: 4,
  },
  netConnectText: { fontSize: 14, fontWeight: '600', color: '#fff' },

  toast: {
    position: 'absolute',
    bottom: 40,
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  toastOk: { backgroundColor: '#16a34a' },
  toastErr: { backgroundColor: '#dc2626' },
  toastText: { color: '#fff', fontSize: 13, fontWeight: '500', flex: 1 },
});
