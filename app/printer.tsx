/**
 * Printer Pairing Screen (KOT_PRINTER_PLAN.md Phase 6)
 *
 * Accessible from both staff and cook profile pages.
 * Handles: scan BT devices, pair, unpair, test print, status display.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { QuinckleColors, Radius, Spacing } from '../constants/Colors';
import { ThemedDialog } from '../components/ui/themed-dialog';
import { WidthPickerSheet } from '../components/ui/WidthPickerSheet';
import { RolePickerSheet } from '../components/ui/RolePickerSheet';
import { NamePrinterSheet } from '../components/ui/NamePrinterSheet';
import {
  scan,
  unpair,
  printTest,
  getStatus,
  getConfig,
  isUpiQrEnabled,
  setUpiQrEnabled,
  isBillLogoEnabled,
  setBillLogoEnabled,
  isUsbSupported,
  listUsbPrinters,
  type BluetoothDevice,
  type PrinterStatus,
  type UsbPrinterDevice,
} from '../services/printer';
import {
  printerApi, printersApi,
  type RegisteredPrinter, type PrinterRole, type PrinterInputBody,
} from '../services/api';
import { refreshLocalPrinters } from '../services/printSink';
import { invalidateInvoicePrinters } from '../services/billPrint';
import { getPrintDeviceId } from '../services/printDevice';
import { useAuth } from '../context/AuthContext';

/** Suffix shown after the paper width on the status card. Bluetooth is the
 *  historical default and stays unlabelled. */
/** The reason lives in the error's `code`; its text is only a fallback. */
function hasCode(err: any, code: string): boolean {
  return [err?.code, err?.message].some((v) => typeof v === 'string' && v.includes(code));
}

/**
 * The hardware's own name, numbered if another printer already has it. Five of
 * the venues' printers report exactly "BlueTooth Printer"; a second one added
 * with "Keep this name" would otherwise be refused as a duplicate.
 */
function uniqueName(base: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  if (!used.has(base.trim().toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

const ROLE_LABEL: Record<string, string> = {
  KOT: 'Kitchen tickets',
  BILL: 'Bills',
  BOTH: 'Kitchen tickets + bills',
};

const TRANSPORT_LABEL: Record<string, string> = {
  network: ' · Network',
  usb: ' · USB',
};

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
  const [billLogo, setBillLogo] = useState(isBillLogoEnabled());

  // Network (LAN/WiFi) printer entry
  const [showNetworkForm, setShowNetworkForm] = useState(false);
  const [networkIp, setNetworkIp] = useState('');
  const [networkPort, setNetworkPort] = useState('9100');

  // USB (OTG) printers. `usbAvailable` is false on builds without the native
  // patch — devices on an older APK still receive this JS over OTA, so the
  // whole USB section must stay hidden there rather than crash on print.
  const usbAvailable = isUsbSupported();
  const [usbDevices, setUsbDevices] = useState<UsbPrinterDevice[]>([]);
  const [isUsbScanning, setIsUsbScanning] = useState(false);
  const [selectedUsb, setSelectedUsb] = useState<UsbPrinterDevice | null>(null);

  const handleUpiQrToggle = useCallback((next: boolean) => {
    setUpiQr(next);
    Haptics.selectionAsync();
    void setUpiQrEnabled(next);
  }, []);

  const handleBillLogoToggle = useCallback((next: boolean) => {
    setBillLogo(next);
    Haptics.selectionAsync();
    void setBillLogoEnabled(next);
  }, []);

  const [dialog, setDialog] = useState<{
    visible: boolean; title: string; message: string;
    actions: { label: string; variant?: 'default' | 'danger' | 'primary'; onPress: () => void }[];
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
    // USB enumeration is instant and permission-free, so fold it into the same
    // gesture — the crew opens one screen and sees every reachable printer.
    void refreshUsbDevices();
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
  // Opens a bottom sheet with the standard roll widths; invokes `onPick` with
  // the chosen width in mm. Used by both the Bluetooth and network pairing flows.

  const [widthPickerVisible, setWidthPickerVisible] = useState(false);
  const widthPickerCallback = useRef<((widthMM: number) => void) | null>(null);

  function chooseWidth(onPick: (widthMM: number) => void) {
    widthPickerCallback.current = onPick;
    setWidthPickerVisible(true);
  }

  function handleWidthPick(widthMM: number) {
    setWidthPickerVisible(false);
    const cb = widthPickerCallback.current;
    widthPickerCallback.current = null;
    cb?.(widthMM);
  }

  // ── The venue's printer registry ────────────────────────────────────────────

  const [registered, setRegistered] = useState<RegisteredPrinter[]>([]);
  const [myDeviceId, setMyDeviceId] = useState<string>('');
  const [busyPrinterId, setBusyPrinterId] = useState<string | null>(null);

  const [rolePickerVisible, setRolePickerVisible] = useState(false);
  const [rolePickerCurrent, setRolePickerCurrent] = useState<PrinterRole | undefined>();
  const rolePickerCallback = useRef<((role: PrinterRole) => void) | null>(null);

  function chooseRole(onPick: (role: PrinterRole) => void, current?: PrinterRole) {
    rolePickerCallback.current = onPick;
    setRolePickerCurrent(current);
    setRolePickerVisible(true);
  }

  function handleRolePick(role: PrinterRole) {
    setRolePickerVisible(false);
    const cb = rolePickerCallback.current;
    rolePickerCallback.current = null;
    cb?.(role);
  }

  // Name sheet. `nameOpen` is separate from its content so the text doesn't
  // blank out while the sheet slides away.
  const [nameOpen, setNameOpen] = useState(false);
  const [nameSheet, setNameSheet] = useState<{
    title: string;
    initialName: string;
    systemName?: string | null;
    takenNames: string[];
    skipLabel?: string;
  }>({ title: '', initialName: '', takenNames: [] });
  const nameCallback = useRef<((name: string | null) => void) | null>(null);

  function chooseName(opts: typeof nameSheet, onDone: (name: string | null) => void) {
    nameCallback.current = onDone;
    setNameSheet(opts);
    setNameOpen(true);
  }

  function finishName(name: string | null) {
    setNameOpen(false);
    const cb = nameCallback.current;
    nameCallback.current = null;
    cb?.(name);
  }

  /**
   * Last step of adding a printer: what staff will call it. Skipping keeps the
   * hardware's own name — numbered if another printer already has it.
   */
  function askNameThen(systemName: string, go: (name: string) => void) {
    const taken = registered.map((p) => p.name);
    const fallback = uniqueName(systemName, taken);
    chooseName(
      {
        title: 'Name this printer',
        initialName: fallback,
        systemName,
        takenNames: taken,
        skipLabel: `Keep “${fallback}”`,
      },
      (name) => go(name ?? fallback),
    );
  }

  const loadPrinters = useCallback(async () => {
    try {
      const [res, deviceId] = await Promise.all([printersApi.list(), getPrintDeviceId()]);
      setRegistered(res?.data ?? []);
      setMyDeviceId(deviceId);
      // Keep what this device actually drives in step with what the server says.
      await refreshLocalPrinters();
      // The Print Invoice picker caches this list — a change made here must
      // show up on the very next bill, not five minutes later.
      invalidateInvoicePrinters();
      setLocalStatus(getStatus());
      setConfig(getConfig());
    } catch {
      /* offline — the cached local list still prints */
    }
  }, []);

  useEffect(() => { void loadPrinters(); }, [loadPrinters]);

  /** Register a printer this device can physically reach, and take its host slot. */
  const registerPrinter = useCallback(async (body: PrinterInputBody, label: string) => {
    const deviceId = await getPrintDeviceId();
    await printersApi.create({ ...body, hostDeviceId: deviceId });
    await loadPrinters();
    showToast(`${label} added`, true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [loadPrinters]);

  const handleRename = useCallback((printer: RegisteredPrinter) => {
    const others = registered.filter((p) => p.id !== printer.id).map((p) => p.name);
    chooseName(
      {
        title: 'Rename printer',
        initialName: printer.name,
        systemName: printer.systemName ?? null,
        takenNames: others,
      },
      (name) => {
        if (!name || name === printer.name) return;
        void (async () => {
          setBusyPrinterId(printer.id);
          try {
            await printersApi.update(printer.id, { name });
            await loadPrinters();
            showToast(`Renamed to ${name}`, true);
          } catch (err: any) {
            showToast(
              hasCode(err, 'PRINTER_NAME_TAKEN')
                ? `Another printer is already called “${name}”.`
                : 'Could not rename this printer',
              false,
            );
          } finally {
            setBusyPrinterId(null);
          }
        })();
      },
    );
  // chooseName only touches setters and a ref, so it is stable in practice.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registered, loadPrinters]);

  const handleChangeRole = useCallback((printer: RegisteredPrinter) => {
    chooseRole((role) => {
      void (async () => {
        setBusyPrinterId(printer.id);
        try {
          await printersApi.update(printer.id, { role });
          await loadPrinters();
        } catch {
          showToast('Could not change what this printer prints', false);
        } finally {
          setBusyPrinterId(null);
        }
      })();
    }, printer.role);
  }, [loadPrinters]);

  /**
   * Where a bill goes when nobody picks: the live app's Print Invoice, and any
   * phone at a venue with only one invoice printer. The server keeps exactly one
   * default per venue, so setting it here clears the old one.
   */
  const handleMakeDefault = useCallback(async (printer: RegisteredPrinter) => {
    setBusyPrinterId(printer.id);
    try {
      await printersApi.update(printer.id, { isDefaultBill: true });
      await loadPrinters();
      showToast(`Bills print on ${printer.name} unless someone picks another`, true);
    } catch {
      showToast(`Could not make ${printer.name} the default`, false);
    } finally {
      setBusyPrinterId(null);
    }
  }, [loadPrinters]);

  const handleTakeOverHost = useCallback(async (printer: RegisteredPrinter) => {
    setBusyPrinterId(printer.id);
    try {
      await printersApi.claimHost(printer.id, await getPrintDeviceId());
      await loadPrinters();
      showToast(`This device now drives ${printer.name}`, true);
    } catch (err: any) {
      showToast(
        hasCode(err, 'PRINTER_BLUETOOTH_HOST_TAKEN')
          ? 'This device already has a Bluetooth printer. A phone can only drive one.'
          : `Could not take over ${printer.name}`,
        false,
      );
    } finally {
      setBusyPrinterId(null);
    }
  }, [loadPrinters]);

  const handleTestPrinter = useCallback(async (printer: RegisteredPrinter) => {
    setBusyPrinterId(printer.id);
    try {
      const result = await printTest({ printerId: printer.id });
      showToast(result === 'printed' ? `Test sent to ${printer.name}` : `${printer.name} did not respond`, result === 'printed');
    } finally {
      setBusyPrinterId(null);
    }
  }, []);

  const handleRemovePrinter = useCallback((printer: RegisteredPrinter) => {
    setDialog({
      visible: true,
      title: `Remove ${printer.name}?`,
      message: printer.role === 'BILL'
        ? 'Bills will stop printing here.'
        : 'Kitchen tickets will stop printing here.',
      actions: [
        { label: 'Cancel', onPress: () => {} },
        {
          label: 'Remove',
          variant: 'danger' as const,
          onPress: () => {
            void (async () => {
              setBusyPrinterId(printer.id);
              try {
                await printersApi.remove(printer.id);
                await loadPrinters();
                showToast(`${printer.name} removed`, true);
              } catch {
                showToast(`Could not remove ${printer.name}`, false);
              } finally {
                setBusyPrinterId(null);
              }
            })();
          },
        },
      ],
    });
  }, [loadPrinters]);

  // A default only means something once there's a choice to make.
  const invoicePrinterCount = registered.filter(
    (p) => p.enabled && (p.role === 'BILL' || p.role === 'BOTH'),
  ).length;

  // ── Pair (Bluetooth) ─────────────────────────────────────────────────────────

  function handlePair(device: BluetoothDevice) {
    // Width first (fixes the old always-58mm bug), then what it prints.
    chooseWidth((width) => chooseRole((role) =>
      askNameThen(device.name || 'Bluetooth printer', (name) => void doPairBluetooth(device, width, role, name))));
  }

  // Registered on the SERVER first, then mirrored locally by loadPrinters. The
  // registry is the source of truth now, so a local-only pairing would just be
  // wiped by the next sync — and a venue with two printers needs both devices
  // to agree on which one drives what.
  async function doPairBluetooth(device: BluetoothDevice, width: number, role: PrinterRole, name: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedDevice(device);
    setIsPairing(true);
    try {
      await registerPrinter({
        name,
        systemName: device.name || 'Bluetooth printer',
        role,
        transport: 'BLUETOOTH',
        address: device.address,
        paperWidth: width,
      }, `${name} · ${width}mm`);
      setShowScanView(false);
    } catch (err: any) {
      showToast(
        hasCode(err, 'PRINTER_BLUETOOTH_HOST_TAKEN')
          ? 'This device already drives a Bluetooth printer. Bluetooth printers pair one-to-one — use a second device, or a network/USB printer.'
          : hasCode(err, 'PRINTER_NAME_TAKEN')
            ? `Another printer is already called “${name}”.`
            : `Failed to pair with ${device.name}`,
        false,
      );
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
    chooseWidth((width) => chooseRole((role) =>
      askNameThen(`Network printer (${ip})`, (name) => void doPairNetwork(ip, width, role, name))));
  }

  async function doPairNetwork(ip: string, width: number, role: PrinterRole, name: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const port = parseInt(networkPort, 10) || 9100;
    setIsPairing(true);
    try {
      await registerPrinter({
        name,
        systemName: `Network printer (${ip})`,
        role, transport: 'NETWORK', ip, port, paperWidth: width,
      }, `${name} · ${width}mm`);
      setShowScanView(false);
      setShowNetworkForm(false);
    } catch (err: any) {
      showToast(
        hasCode(err, 'PRINTER_DUPLICATE')
          ? 'That printer is already in the list.'
          : hasCode(err, 'PRINTER_NAME_TAKEN')
            ? `Another printer is already called “${name}”.`
            : 'Failed to reach the network printer. Check the IP and that it is on the same WiFi.',
        false,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsPairing(false);
    }
  }

  // ── Pair (USB / OTG) ─────────────────────────────────────────────────────────

  const refreshUsbDevices = useCallback(async () => {
    if (!usbAvailable) return;
    setIsUsbScanning(true);
    try {
      setUsbDevices(await listUsbPrinters());
    } finally {
      setIsUsbScanning(false);
    }
  }, [usbAvailable]);

  function handlePairUsb(device: UsbPrinterDevice) {
    chooseWidth((width) => chooseRole((role) =>
      askNameThen(device.deviceName || 'USB printer', (name) => void doPairUsb(device, width, role, name))));
  }

  async function doPairUsb(device: UsbPrinterDevice, width: number, role: PrinterRole, name: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedUsb(device);
    setIsPairing(true);
    try {
      await registerPrinter({
        name,
        systemName: device.deviceName || 'USB printer',
        role,
        transport: 'USB',
        usbVendorId: device.vendorId,
        usbProductId: device.productId,
        paperWidth: width,
      }, `${name} · ${width}mm`);
      setShowScanView(false);
    } catch (err: any) {
      showToast(
        hasCode(err, 'PRINTER_DUPLICATE')
          // Two printers of the SAME MODEL report identical vendor/product ids,
          // and neither platform can currently tell them apart. Say so rather
          // than adding a second row that silently drives the first printer.
          ? 'A printer with these USB ids is already in the list. Two identical USB printers cannot be told apart yet — use different models, or connect one over the network.'
          : hasCode(err, 'PRINTER_NAME_TAKEN')
            ? `Another printer is already called “${name}”.`
            : `Failed to pair with ${device.deviceName}`,
        false,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsPairing(false);
      setSelectedUsb(null);
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
              showToast('Printer has been unpaired', false);
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
        {/* The venue's printers. Every device sees the same list; the ones this
            device physically drives are marked, and only those can be tested
            from here. */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>PRINTERS</Text>

          {registered.length === 0 && (
            <Text style={styles.emptyText}>
              No printers yet. Add one below and choose what it prints.
            </Text>
          )}

          {registered.map((printer) => {
            const mine = printer.hostDeviceId === myDeviceId;
            const busy = busyPrinterId === printer.id;
            return (
              <View key={printer.id} style={styles.printerRow}>
                <View style={styles.printerHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.printerName} numberOfLines={1}>{printer.name}</Text>
                    {!!printer.systemName && printer.systemName !== printer.name && (
                      <Text style={styles.printerSystem} numberOfLines={1}>{printer.systemName}</Text>
                    )}
                    <Text style={styles.printerMeta}>
                      {ROLE_LABEL[printer.role]} · {printer.paperWidth}mm
                      {TRANSPORT_LABEL[printer.transport.toLowerCase()] ?? ''}
                    </Text>
                    <Text style={[styles.printerHost, mine && styles.printerHostMine]}>
                      {mine
                        ? 'Connected to this device'
                        : printer.hostDeviceId
                          ? 'Connected to another device'
                          : 'Not connected to any device'}
                      {printer.lastError ? ' · last print failed' : ''}
                    </Text>
                    {invoicePrinterCount >= 2 && printer.isDefaultBill && (
                      <Text style={styles.printerDefault}>Default for bills</Text>
                    )}
                  </View>
                  {busy && <ActivityIndicator size="small" color={QuinckleColors.primary} />}
                </View>

                <View style={styles.printerActions}>
                  <TouchableOpacity
                    style={styles.printerAction}
                    onPress={() => handleRename(printer)}
                    disabled={busy}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="pencil-outline" size={16} color={QuinckleColors.textPrimary} />
                    <Text style={styles.printerActionText}>Rename</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.printerAction}
                    onPress={() => handleChangeRole(printer)}
                    disabled={busy}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="swap-horizontal-outline" size={16} color={QuinckleColors.textPrimary} />
                    <Text style={styles.printerActionText}>Prints</Text>
                  </TouchableOpacity>

                  {invoicePrinterCount >= 2
                    && (printer.role === 'BILL' || printer.role === 'BOTH')
                    && !printer.isDefaultBill && (
                    <TouchableOpacity
                      style={styles.printerAction}
                      onPress={() => void handleMakeDefault(printer)}
                      disabled={busy}
                      activeOpacity={0.75}
                    >
                      <Ionicons name="star-outline" size={16} color={QuinckleColors.textPrimary} />
                      <Text style={styles.printerActionText}>Make default</Text>
                    </TouchableOpacity>
                  )}

                  {mine ? (
                    <TouchableOpacity
                      style={styles.printerAction}
                      onPress={() => void handleTestPrinter(printer)}
                      disabled={busy}
                      activeOpacity={0.75}
                    >
                      <Ionicons name="print-outline" size={16} color={QuinckleColors.primary} />
                      <Text style={[styles.printerActionText, { color: QuinckleColors.primary }]}>Test</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.printerAction}
                      onPress={() => void handleTakeOverHost(printer)}
                      disabled={busy}
                      activeOpacity={0.75}
                    >
                      <Ionicons name="phone-portrait-outline" size={16} color={QuinckleColors.primary} />
                      <Text style={[styles.printerActionText, { color: QuinckleColors.primary }]}>Use this device</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={styles.printerAction}
                    onPress={() => handleRemovePrinter(printer)}
                    disabled={busy}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="trash-outline" size={16} color={QuinckleColors.danger} />
                    <Text style={[styles.printerActionText, { color: QuinckleColors.danger }]}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>

        {/* Status card */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>THIS DEVICE</Text>

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
                      ? `Connected · ${config.paperWidth}mm${TRANSPORT_LABEL[config.transport] ?? ''}`
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

          {/* Venue logo at the top of bills — Android only, the iOS printer
              bridge can't print images. */}
          {Platform.OS === 'android' && (
            <View style={styles.autoPrintRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.autoPrintLabel}>Print logo on bills</Text>
                <Text style={styles.autoPrintSub}>Your restaurant logo at the top of every bill from this device</Text>
              </View>
              <TouchableOpacity
                onPress={() => handleBillLogoToggle(!billLogo)}
                activeOpacity={0.8}
                style={[styles.toggleTrack, billLogo && styles.toggleTrackOn]}
              >
                <View style={[styles.toggleThumb, billLogo && styles.toggleThumbOn]} />
              </TouchableOpacity>
            </View>
          )}
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

            {/* USB / OTG printers — hidden entirely on builds without the
                native USB bridge (see usbAvailable). */}
            {usbAvailable && (
              <>
                <View style={styles.netDivider} />
                <View style={styles.scanHeader}>
                  <Text style={styles.sectionLabel}>USB PRINTERS</Text>
                  {isUsbScanning && <ActivityIndicator size="small" color={QuinckleColors.primary} />}
                </View>

                {usbDevices.length === 0 && !isUsbScanning && (
                  <Text style={styles.emptyText}>
                    No USB printer detected. Connect it with an OTG cable and make sure it is powered on.
                  </Text>
                )}

                {usbDevices.map((device) => (
                  <TouchableOpacity
                    key={`${device.vendorId}:${device.productId}`}
                    style={[
                      styles.deviceRow,
                      isPairing
                        && selectedUsb?.vendorId === device.vendorId
                        && selectedUsb?.productId === device.productId
                        && styles.deviceRowLoading,
                    ]}
                    onPress={() => handlePairUsb(device)}
                    disabled={isPairing}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="hardware-chip-outline" size={20} color={QuinckleColors.textSecondary} />
                    <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                      <Text style={styles.deviceName}>{device.deviceName}</Text>
                      <Text style={styles.deviceAddress}>USB · {device.vendorId}:{device.productId}</Text>
                    </View>
                    {isPairing
                      && selectedUsb?.vendorId === device.vendorId
                      && selectedUsb?.productId === device.productId
                      ? <ActivityIndicator size="small" color={QuinckleColors.primary} />
                      : <Ionicons name="chevron-forward" size={16} color={QuinckleColors.textTertiary} />
                    }
                  </TouchableOpacity>
                ))}

                {!isUsbScanning && (
                  <TouchableOpacity style={styles.rescanBtn} onPress={() => void refreshUsbDevices()} activeOpacity={0.7}>
                    <Ionicons name="refresh-outline" size={15} color={QuinckleColors.primary} />
                    <Text style={styles.rescanText}>Check for USB printers</Text>
                  </TouchableOpacity>
                )}
              </>
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

      <WidthPickerSheet
        visible={widthPickerVisible}
        onPick={handleWidthPick}
        onClose={() => setWidthPickerVisible(false)}
      />

      <NamePrinterSheet
        visible={nameOpen}
        title={nameSheet.title}
        initialName={nameSheet.initialName}
        systemName={nameSheet.systemName}
        takenNames={nameSheet.takenNames}
        skipLabel={nameSheet.skipLabel}
        onSave={(name) => finishName(name)}
        onClose={() => finishName(null)}
      />

      <RolePickerSheet
        visible={rolePickerVisible}
        current={rolePickerCurrent}
        onPick={handleRolePick}
        onClose={() => setRolePickerVisible(false)}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  printerRow: {
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: QuinckleColors.border,
  },
  printerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  printerName: { fontSize: 15, fontWeight: '600', color: QuinckleColors.textPrimary },
  printerSystem: { fontSize: 12, color: QuinckleColors.textMuted, marginTop: 1 },
  printerMeta: { fontSize: 12, color: QuinckleColors.textSecondary, marginTop: 2 },
  printerHost: { fontSize: 12, color: QuinckleColors.textMuted, marginTop: 2 },
  printerHostMine: {
    color: QuinckleColors.success,
  },
  printerDefault: { fontSize: 12, fontWeight: '600', color: QuinckleColors.primary, marginTop: 2 },
  printerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  printerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  printerActionText: { fontSize: 12, fontWeight: '600', color: QuinckleColors.textPrimary },
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
