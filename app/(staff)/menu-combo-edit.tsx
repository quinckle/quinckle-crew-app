import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { adminCombos, adminMenu, adminModifiers, uploadMenuImage, type AppModifierGroup, type ComboChannel, type ComboDailyCapMode, type ComboItemDetail, type DineMenuCategory, type DineMenuItem } from '@/services/menuAdmin';
import { QuinckleColors, Spacing, Radius, Typography } from '@/constants/Colors';
import { AlertProvider, useAlert } from '@/components/menu-admin/AppAlert';
import { useAuth } from '@/context/AuthContext';
import { CAP } from '@/constants/capabilities';
import { ChangeHistory } from '@/components/menu-admin/ChangeHistory';
import { TimeField, formatSpan } from '@/components/menu-admin/TimeClockPicker';

// ── Schedule helpers ──────────────────────────────────────────────────────────
// The backend stores the daily window as minutes from IST midnight and the date
// range as UTC instants; the window is held as minutes end to end (the clock
// picker speaks the same unit) and dates as "YYYY-MM-DD" strings (IST).
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const IST_OFFSET_MS = 330 * 60 * 1000;

/** Route params arrive as an untyped JSON blob — keep only a real minute-of-day. */
const toMinute = (raw: unknown): number | null => {
  const n = Number(raw);
  return raw == null || !Number.isFinite(n) || n < 0 || n > 1439 ? null : Math.round(n);
};
const isoToISTDate = (iso?: string | null): string =>
  !iso ? '' : new Date(new Date(iso).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
const isValidDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T00:00:00`).getTime());

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}{required && <Text style={{ color: QuinckleColors.danger }}> *</Text>}
      </Text>
      {children}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress(): void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ToggleRow({ label, sub, on, onToggle }: { label: string; sub?: string; on: boolean; onToggle(): void }) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1, paddingRight: Spacing.md }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {sub ? <Text style={styles.toggleSub}>{sub}</Text> : null}
      </View>
      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.8}
        style={[styles.switch, on && styles.switchOn]}
      >
        <View style={[styles.switchKnob, on && styles.switchKnobOn]} />
      </TouchableOpacity>
    </View>
  );
}

function VegDot({ isVeg }: { isVeg: boolean }) {
  return (
    <View style={[styles.vegBox, { borderColor: isVeg ? QuinckleColors.success : QuinckleColors.danger }]}>
      <View style={[styles.vegDot, { backgroundColor: isVeg ? QuinckleColors.success : QuinckleColors.danger }]} />
    </View>
  );
}

// Ported from the partner app; the crew root has no AlertProvider, so each
// menu-admin screen brings its own.
export default function ComboEditScreenRoute() {
  return (
    <AlertProvider>
      <ComboEditScreen />
    </AlertProvider>
  );
}

function ComboEditScreen() {
  const insets = useSafeAreaInsets();
  const alert = useAlert();
  // Deleting is its own capability (MENU_DELETE) — the server refuses it
  // regardless; hiding the control just saves a staffer the 403.
  const canDelete = useAuth().can(CAP.MENU_DELETE);
  const params = useLocalSearchParams<{
    id?: string;
    title?: string;
    description?: string;
    tag?: string;
    imageUrl?: string;
    itemDetailsJson?: string; // JSON ComboItemDetail[]
    rulesJson?: string;       // JSON { channels, schedule, caps }
  }>();

  const isEdit = !!params.id;

  const [title, setTitle] = useState(params.title ?? '');
  const [description, setDescription] = useState(params.description ?? '');
  const [badge, setBadge] = useState(params.tag ?? '');
  const [imageUri, setImageUri] = useState<string | null>(params.imageUrl ?? null);
  const [imageChanged, setImageChanged] = useState(false);

  const parseInitialItems = (): ComboItemDetail[] => {
    if (!params.itemDetailsJson) return [];
    try { return JSON.parse(params.itemDetailsJson); } catch { return []; }
  };
  const [items, setItems] = useState<ComboItemDetail[]>(parseInitialItems);

  // ── Advanced availability rules (parity with the web combo editor) ──────────
  // channels / schedule / caps arrive as one JSON blob from the menu list.
  const initialRules = (() => {
    try { return params.rulesJson ? JSON.parse(params.rulesJson) : {}; } catch { return {}; }
  })();
  const [takeawayEnabled, setTakeawayEnabled] = useState<boolean>(
    Array.isArray(initialRules.channels) && initialRules.channels.includes('TAKEAWAY')
  );
  const [scheduleEnabled, setScheduleEnabled] = useState<boolean>(!!initialRules.scheduleEnabled);
  const [availableDays, setAvailableDays] = useState<number[]>(
    Array.isArray(initialRules.availableDays) ? initialRules.availableDays : []
  );
  const [windowStart, setWindowStart] = useState<number | null>(() => toMinute(initialRules.windowStartMinute));
  const [windowEnd, setWindowEnd] = useState<number | null>(() => toMinute(initialRules.windowEndMinute));
  const [validFrom, setValidFrom] = useState<string>(isoToISTDate(initialRules.validFrom));
  const [validUntil, setValidUntil] = useState<string>(isoToISTDate(initialRules.validUntil));
  const [dailyCap, setDailyCap] = useState<string>(initialRules.dailyCap != null ? String(initialRules.dailyCap) : '');
  const [dailyCapMode, setDailyCapMode] = useState<ComboDailyCapMode>(
    initialRules.dailyCapMode === 'PER_QUANTITY' ? 'PER_QUANTITY' : 'PER_REDEMPTION'
  );
  const [lifetimeCap, setLifetimeCap] = useState<string>(initialRules.lifetimeCap != null ? String(initialRules.lifetimeCap) : '');
  const lifetimeRedeemed = Number(initialRules.lifetimeRedeemed) || 0;
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const toggleDay = (d: number) =>
    setAvailableDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a, b) => a - b));

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Menu browser — search + horizontal category tabs
  const [menuCategories, setMenuCategories] = useState<DineMenuCategory[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [browseSearch, setBrowseSearch] = useState('');
  const [activeTab, setActiveTab] = useState('');

  useEffect(() => {
    setMenuLoading(true);
    adminMenu.getMenu()
      .then(cats => {
        const list = Array.isArray(cats) ? cats : [];
        setMenuCategories(list);
        setActiveTab(prev => prev || list[0]?.name || '');
      })
      .catch(() => {})
      .finally(() => setMenuLoading(false));
  }, []);

  // Full-screen add/edit item price entry — slide+fade overlay, same pattern as offers.tsx
  const [itemScreenOpen, setItemScreenOpen] = useState(false);
  const itemScreenSlideY = useRef(new Animated.Value(40)).current;
  const itemScreenFade = useRef(new Animated.Value(0)).current;
  const [itemScreenIdx, setItemScreenIdx] = useState<number | null>(null);
  const [itemScreenName, setItemScreenName] = useState('');
  const [itemScreenIsVeg, setItemScreenIsVeg] = useState<boolean | null>(null);
  const [itemScreenAvailable, setItemScreenAvailable] = useState<boolean | null>(null);
  const [itemScreenRegularPrice, setItemScreenRegularPrice] = useState('');
  const [itemScreenComboPrice, setItemScreenComboPrice] = useState('');
  // Optional per-component takeaway price ('' = same as the combo price).
  const [itemScreenTakeawayPrice, setItemScreenTakeawayPrice] = useState('');
  const [itemScreenQty, setItemScreenQty] = useState(1);
  const [itemScreenMenuItemId, setItemScreenMenuItemId] = useState<string | undefined>(undefined);
  // Combo modifier toggles: which of this item's modifier options are hidden
  // in THIS combo (diners pick modifiers free inside a combo, so partners hide
  // e.g. paid upgrades). Groups are fetched lazily per menuItemId and cached.
  const [itemScreenExcluded, setItemScreenExcluded] = useState<string[]>([]);
  const [modGroupsByItem, setModGroupsByItem] = useState<Record<string, AppModifierGroup[] | null>>({});

  const loadModGroups = (menuItemId?: string) => {
    if (!menuItemId || menuItemId in modGroupsByItem) return;
    setModGroupsByItem(prev => ({ ...prev, [menuItemId]: null }));
    adminModifiers.getGroups(menuItemId)
      .then((groups: AppModifierGroup[]) => setModGroupsByItem(prev => ({ ...prev, [menuItemId]: groups.filter(g => g.isActive !== false) })))
      .catch(() => setModGroupsByItem(prev => ({ ...prev, [menuItemId]: [] })));
  };

  const toggleExcludedOption = (optionId: string) => {
    Haptics.selectionAsync();
    setItemScreenExcluded(prev =>
      prev.includes(optionId) ? prev.filter(id => id !== optionId) : [...prev, optionId]
    );
  };

  const findMenuItemByName = (name: string): DineMenuItem | undefined => {
    const lower = name.trim().toLowerCase();
    for (const cat of menuCategories) {
      const found = cat.items.find(it => it.name.toLowerCase() === lower);
      if (found) return found;
    }
    return undefined;
  };

  const openItemScreenAnim = () => {
    itemScreenSlideY.setValue(40);
    itemScreenFade.setValue(0);
    setItemScreenOpen(true);
    Animated.parallel([
      Animated.spring(itemScreenSlideY, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 200, mass: 0.9 }),
      Animated.timing(itemScreenFade, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  };

  const closeItemScreenAnim = (cb?: () => void) => {
    Animated.parallel([
      Animated.timing(itemScreenSlideY, { toValue: 24, duration: 180, useNativeDriver: true }),
      Animated.timing(itemScreenFade, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start(() => { setItemScreenOpen(false); cb?.(); });
  };

  const openAddFromMenu = (item: DineMenuItem) => {
    setItemScreenIdx(null);
    setItemScreenName(item.name);
    setItemScreenIsVeg(item.isVeg);
    setItemScreenAvailable(item.isAvailable);
    setItemScreenRegularPrice(item.price ? String(parseFloat(item.price)) : '');
    setItemScreenComboPrice(item.price ? String(parseFloat(item.price)) : '');
    setItemScreenTakeawayPrice('');
    setItemScreenQty(1);
    setItemScreenMenuItemId(item.id);
    setItemScreenExcluded([]);
    loadModGroups(item.id);
    openItemScreenAnim();
  };

  const openEditItem = (idx: number) => {
    const it = items[idx];
    const match = findMenuItemByName(it.name);
    setItemScreenIdx(idx);
    setItemScreenName(it.name);
    setItemScreenIsVeg(match ? match.isVeg : null);
    setItemScreenAvailable(match ? match.isAvailable : null);
    setItemScreenRegularPrice(it.originalPrice ? String(it.originalPrice) : '');
    setItemScreenComboPrice(it.comboPrice ? String(it.comboPrice) : '');
    setItemScreenTakeawayPrice(it.takeawayPrice != null ? String(it.takeawayPrice) : '');
    setItemScreenQty(it.quantity || 1);
    const resolvedId = it.menuItemId ?? match?.id;
    setItemScreenMenuItemId(resolvedId);
    setItemScreenExcluded(Array.isArray(it.excludedOptionIds) ? it.excludedOptionIds : []);
    loadModGroups(resolvedId);
    openItemScreenAnim();
  };

  const closeItemScreen = () => closeItemScreenAnim();

  const confirmItemScreen = () => {
    if (!itemScreenName.trim()) return;
    const takeaway = parseFloat(itemScreenTakeawayPrice);
    const detail: ComboItemDetail = {
      menuItemId: itemScreenMenuItemId,
      name: itemScreenName.trim(),
      comboPrice: parseFloat(itemScreenComboPrice) || 0,
      originalPrice: parseFloat(itemScreenRegularPrice) || 0,
      // Blank/invalid takeaway price ⇒ null (diner pays the combo price for takeaway).
      takeawayPrice: itemScreenTakeawayPrice.trim() !== '' && takeaway > 0 ? takeaway : null,
      quantity: itemScreenQty,
      ...(itemScreenExcluded.length > 0 ? { excludedOptionIds: itemScreenExcluded } : {}),
    };
    closeItemScreenAnim(() => {
      if (itemScreenIdx !== null) {
        setItems(prev => prev.map((it, i) => i === itemScreenIdx ? detail : it));
      } else {
        setItems(prev => [...prev, detail]);
      }
    });
  };

  const removeItem = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      alert.info('Allow access to your photo library to add a combo image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      setImageChanged(true);
    }
  };

  const capOk = (v: string) => v === '' || (Number.isInteger(Number(v)) && Number(v) >= 1);

  const validate = () => {
    if (!title.trim()) { alert.error('Combo title is required.'); return false; }
    if (items.length === 0) { alert.error('Add at least one item to the combo.'); return false; }
    for (const it of items) {
      if (!it.name.trim()) { alert.error('Each combo item needs a name.'); return false; }
      if (it.comboPrice < 0) { alert.error('Combo price must be 0 or more.'); return false; }
    }
    if (scheduleEnabled) {
      if ((windowStart == null) !== (windowEnd == null)) { alert.error('Set both start and end time, or clear both.'); return false; }
      // Combo windows cannot cross midnight — the backend's combo-rules engine
      // rejects it, unlike an item's availability window.
      if (windowStart != null && windowEnd != null && windowEnd <= windowStart) { alert.error('End time must be after the start time.'); return false; }
      if (validFrom && !isValidDate(validFrom)) { alert.error('Start date must be YYYY-MM-DD.'); return false; }
      if (validUntil && !isValidDate(validUntil)) { alert.error('End date must be YYYY-MM-DD.'); return false; }
      if (validFrom && validUntil && validUntil < validFrom) { alert.error('End date must be on or after the start date.'); return false; }
    }
    if (!capOk(dailyCap) || !capOk(lifetimeCap)) { alert.error('Limits must be whole numbers of at least 1.'); return false; }
    return true;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      let finalImageUrl: string | undefined = imageUri ?? undefined;
      if (imageChanged && imageUri) {
        const ext = imageUri.split('.').pop() ?? 'jpg';
        const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
        finalImageUrl = await uploadMenuImage(imageUri, mime);
      } else if (imageChanged && !imageUri) {
        finalImageUrl = undefined;
      }

      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        tag: badge.trim() || 'Deal',
        imageUrl: finalImageUrl,
        itemDetails: items.map(it => ({
          menuItemId: it.menuItemId,
          name: it.name.trim(),
          comboPrice: Number(it.comboPrice),
          originalPrice: Number(it.originalPrice),
          // Round-trip per-component takeaway price — omitting it would wipe
          // prices set in the web dashboard on every app save.
          takeawayPrice: it.takeawayPrice != null && it.takeawayPrice > 0 ? Number(it.takeawayPrice) : null,
          quantity: it.quantity || 1,
          // Round-trip combo modifier exclusions — omitting this field here
          // would wipe exclusions set in the web dashboard on every app save.
          ...(it.excludedOptionIds?.length ? { excludedOptionIds: it.excludedOptionIds } : {}),
        })),
        // Availability rules — sent explicitly so the app matches the web editor.
        // The backend only touches schedule/caps when their keys are present.
        channels: (takeawayEnabled ? ['DINE_IN', 'TAKEAWAY'] : ['DINE_IN']) as ComboChannel[],
        scheduleEnabled,
        availableDays: scheduleEnabled ? availableDays : [],
        windowStartMinute: scheduleEnabled ? windowStart : null,
        windowEndMinute: scheduleEnabled ? windowEnd : null,
        // Date range is inclusive in IST: start of validFrom day → end of validUntil day.
        validFrom: scheduleEnabled && validFrom ? new Date(`${validFrom}T00:00:00+05:30`).toISOString() : null,
        validUntil: scheduleEnabled && validUntil ? new Date(`${validUntil}T23:59:59+05:30`).toISOString() : null,
        dailyCap: dailyCap === '' ? null : parseInt(dailyCap, 10),
        dailyCapMode,
        lifetimeCap: lifetimeCap === '' ? null : parseInt(lifetimeCap, 10),
      };

      if (isEdit && params.id) {
        await adminCombos.update(params.id, payload);
      } else {
        await adminCombos.create(payload);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e: any) {
      alert.error(e.message ?? 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  const deleteCombo = () => {
    alert.confirm('Delete combo', `Remove "${title}"? This cannot be undone.`, async () => {
      setDeleting(true);
      try {
        await adminCombos.delete(params.id!);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.back();
      } catch (e: any) {
        alert.error(e.message ?? 'Failed to delete combo.');
      } finally {
        setDeleting(false);
      }
    }, { danger: true, confirmText: 'Delete' });
  };

  const addedNameSet = new Set(items.filter(it => it.name.trim()).map(it => it.name.trim().toLowerCase()));

  const categoryTabs = menuCategories.map(c => c.name);
  const searchLower = browseSearch.trim().toLowerCase();
  const isSearching = searchLower.length > 0;
  // Typing a search term looks across every category; with an empty search
  // box, browsing stays scoped to whichever category tab is active.
  const visibleItems: (DineMenuItem & { categoryName: string })[] = (
    isSearching ? menuCategories : menuCategories.filter(cat => cat.name === activeTab)
  )
    .flatMap(cat => cat.items.map(it => ({ ...it, categoryName: cat.name })))
    .filter(it => it.name.toLowerCase().includes(searchLower));

  // Pricing summary — mirrors the web dashboard's combo pricing summary card
  const summaryCombo = items.reduce((s, it) => s + it.comboPrice * (it.quantity || 1), 0);
  const summaryOriginal = items.reduce((s, it) => s + it.originalPrice * (it.quantity || 1), 0);
  const summaryDiscountPct = summaryOriginal > 0 ? Math.round((1 - summaryCombo / summaryOriginal) * 100) : 0;
  const summarySavings = summaryOriginal - summaryCombo;
  // Effective takeaway total: components without a takeaway price fall back to the combo price.
  const anyTakeawayPrice = items.some(it => it.takeawayPrice != null && it.takeawayPrice > 0);
  const summaryTakeaway = items.reduce((s, it) => {
    const tp = it.takeawayPrice != null && it.takeawayPrice > 0 ? it.takeawayPrice : it.comboPrice;
    return s + tp * (it.quantity || 1);
  }, 0);

  // Item screen — live savings preview
  const regularPriceNum = parseFloat(itemScreenRegularPrice) || 0;
  const comboPriceNum = parseFloat(itemScreenComboPrice) || 0;
  const regularTotal = regularPriceNum * itemScreenQty;
  const comboTotal = comboPriceNum * itemScreenQty;
  const priceDiff = regularTotal - comboTotal;
  const priceDiffPct = regularPriceNum > 0 ? Math.round(((regularPriceNum - comboPriceNum) / regularPriceNum) * 100) : 0;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>{isEdit ? 'Edit Combo' : 'New Combo'}</Text>
          <TouchableOpacity
            onPress={save}
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            disabled={saving}
            activeOpacity={0.8}
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Save</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.huge }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Image banner */}
          <TouchableOpacity style={styles.imageBanner} onPress={pickImage} activeOpacity={0.85}>
            {imageUri ? (
              <>
                <Image source={{ uri: imageUri }} style={styles.imagePreview} />
                <TouchableOpacity style={styles.imageRemove} onPress={() => { setImageUri(null); setImageChanged(true); }}>
                  <Ionicons name="close-circle" size={24} color="#fff" />
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.imagePlaceholder}>
                <Ionicons name="image-outline" size={30} color={QuinckleColors.textMuted} />
                <Text style={styles.imagePlaceholderText}>Add combo banner (optional)</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Name */}
          <Field label="Combo name" required>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Date Night Special"
              placeholderTextColor={QuinckleColors.textMuted}
              autoCorrect={false}
            />
          </Field>

          {/* Badge — fully custom text */}
          <Field label="Badge">
            <TextInput
              style={styles.input}
              value={badge}
              onChangeText={setBadge}
              placeholder="e.g. Deal, Bestseller, Weekend Special…"
              placeholderTextColor={QuinckleColors.textMuted}
              autoCorrect={false}
            />
          </Field>

          {/* Description */}
          <Field label="Description">
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="What's included (optional)"
              placeholderTextColor={QuinckleColors.textMuted}
              multiline
              numberOfLines={3}
              autoCorrect={false}
            />
          </Field>

          {/* Advanced options — takeaway / schedule / limits (parity with web) */}
          <View style={styles.advCard}>
            <TouchableOpacity onPress={() => setAdvancedOpen(o => !o)} activeOpacity={0.8} style={styles.advHeader}>
              <Ionicons name="options-outline" size={16} color={QuinckleColors.textSecondary} />
              <Text style={styles.advHeaderText}>Advanced options</Text>
              <View style={{ flex: 1 }} />
              {!advancedOpen && (takeawayEnabled || scheduleEnabled || dailyCap !== '' || lifetimeCap !== '') && (
                <View style={styles.advDot} />
              )}
              <Ionicons name={advancedOpen ? 'chevron-up' : 'chevron-down'} size={16} color={QuinckleColors.textSecondary} />
            </TouchableOpacity>

            {advancedOpen && (
              <View style={styles.advBody}>
                {/* Takeaway availability */}
                <ToggleRow
                  label="Available on takeaway"
                  sub="Combos always show on dine-in. Turn on to also offer this on your takeaway page."
                  on={takeawayEnabled}
                  onToggle={() => setTakeawayEnabled(v => !v)}
                />

                <View style={styles.advDivider} />

                {/* Availability schedule */}
                <ToggleRow
                  label="Availability schedule"
                  sub="Limit this combo to certain days, hours or dates."
                  on={scheduleEnabled}
                  onToggle={() => setScheduleEnabled(v => !v)}
                />
                {scheduleEnabled && (
                  <View style={{ gap: Spacing.md, marginTop: Spacing.sm }}>
                    <View>
                      <Text style={styles.advHint}>Days (none selected = every day)</Text>
                      <View style={styles.chipRow}>
                        {DAY_LABELS.map((lbl, d) => (
                          <Chip key={d} label={lbl} active={availableDays.includes(d)} onPress={() => toggleDay(d)} />
                        ))}
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                      <TimeField
                        label="From"
                        value={windowStart}
                        defaultValue={9 * 60}
                        onChange={setWindowStart}
                        onClear={() => setWindowStart(null)}
                        helper="When the combo starts being orderable."
                      />
                      <TimeField
                        label="Until"
                        value={windowEnd}
                        defaultValue={18 * 60}
                        onChange={setWindowEnd}
                        onClear={() => setWindowEnd(null)}
                        helper="Must be later than the start — a combo window cannot cross midnight."
                      />
                    </View>

                    {windowStart != null && windowEnd != null && windowEnd > windowStart && (
                      <Text style={styles.advHint}>Running for {formatSpan(windowStart, windowEnd)}</Text>
                    )}
                    <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.advHint}>Start date (optional)</Text>
                        <TextInput style={styles.input} value={validFrom} onChangeText={setValidFrom}
                          placeholder="YYYY-MM-DD" placeholderTextColor={QuinckleColors.textMuted} keyboardType="numbers-and-punctuation" autoCapitalize="none" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.advHint}>End date (optional)</Text>
                        <TextInput style={styles.input} value={validUntil} onChangeText={setValidUntil}
                          placeholder="YYYY-MM-DD" placeholderTextColor={QuinckleColors.textMuted} keyboardType="numbers-and-punctuation" autoCapitalize="none" />
                      </View>
                    </View>
                  </View>
                )}

                <View style={styles.advDivider} />

                {/* Redemption limits */}
                <View>
                  <Text style={styles.advSectionTitle}>Redemption limits</Text>
                  <Text style={styles.advSectionSub}>Cap how many times this combo can be availed. Leave blank for unlimited.</Text>
                  <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.advHint}>Daily limit</Text>
                      <TextInput style={styles.input} value={dailyCap} onChangeText={setDailyCap}
                        placeholder="∞" placeholderTextColor={QuinckleColors.textMuted} keyboardType="number-pad" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.advHint}>Total limit (all time)</Text>
                      <TextInput style={styles.input} value={lifetimeCap} onChangeText={setLifetimeCap}
                        placeholder="∞" placeholderTextColor={QuinckleColors.textMuted} keyboardType="number-pad" />
                    </View>
                  </View>
                  {dailyCap !== '' && (
                    <View style={{ marginTop: Spacing.sm }}>
                      <Text style={styles.advHint}>How to count the daily limit</Text>
                      <View style={styles.segmented}>
                        {([['PER_REDEMPTION', 'Per order'], ['PER_QUANTITY', 'By quantity']] as [ComboDailyCapMode, string][]).map(([mode, lbl]) => (
                          <TouchableOpacity
                            key={mode}
                            style={[styles.segment, dailyCapMode === mode && styles.segmentActive]}
                            onPress={() => setDailyCapMode(mode)}
                            activeOpacity={0.8}
                          >
                            <Text style={[styles.segmentText, dailyCapMode === mode && styles.segmentTextActive]}>{lbl}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <Text style={styles.advHint}>
                        {dailyCapMode === 'PER_QUANTITY' ? 'An order of 3 combos uses 3 of the limit.' : 'An order counts once, whatever the quantity.'}
                      </Text>
                    </View>
                  )}
                  {lifetimeCap !== '' && isEdit && (
                    <Text style={styles.advProgress}>
                      Claimed so far: {lifetimeRedeemed} of {lifetimeCap}. Changing the total limit restarts this count.
                    </Text>
                  )}
                </View>
              </View>
            )}
          </View>

          {/* Pricing summary — mirrors web dashboard's combo pricing summary card */}
          {items.length > 0 && (
            <View style={[styles.summaryCard, summaryDiscountPct > 0 && styles.summaryCardWithSavings]}>
              <Text style={styles.summaryCardLabel}>Pricing summary</Text>
              <View style={styles.summaryCardRow}>
                <View>
                  <Text style={styles.summaryCardSubLabel}>Combo price</Text>
                  <Text style={styles.summaryCardPrice}>₹{summaryCombo.toFixed(0)}</Text>
                  {summaryOriginal > summaryCombo && (
                    <Text style={styles.summaryCardOriginal}>₹{summaryOriginal.toFixed(0)} regular</Text>
                  )}
                  {anyTakeawayPrice && takeawayEnabled && (
                    <Text style={styles.summaryCardTakeaway}>₹{summaryTakeaway.toFixed(0)} takeaway</Text>
                  )}
                </View>
                {summaryDiscountPct > 0 && (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.summaryCardPct}>{summaryDiscountPct}%</Text>
                    <Text style={styles.summaryCardSaves}>saves ₹{summarySavings.toFixed(0)}</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Added items */}
          {items.length > 0 && (
            <View style={styles.addedSection}>
              <Text style={styles.sectionLabel}>Added items ({items.length})</Text>
              <View style={styles.addedList}>
                {items.map((it, idx) => {
                  const qty = it.quantity || 1;
                  const diff = (it.originalPrice - it.comboPrice) * qty;
                  const pct = it.originalPrice > 0 ? Math.round(((it.originalPrice - it.comboPrice) / it.originalPrice) * 100) : 0;
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[styles.addedRow, idx > 0 && styles.addedRowBorder]}
                      activeOpacity={0.7}
                      onPress={() => openEditItem(idx)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.addedRowName} numberOfLines={1}>
                          {qty > 1 ? `${qty}× ` : ''}{it.name || 'Untitled item'}
                        </Text>
                        <View style={styles.addedRowPriceLine}>
                          <Text style={styles.addedRowComboPrice}>₹{it.comboPrice * qty}</Text>
                          {it.originalPrice > it.comboPrice && (
                            <>
                              <Text style={styles.addedRowOriginalPrice}>₹{it.originalPrice * qty}</Text>
                              <View style={styles.addedRowSaveBadge}>
                                <Text style={styles.addedRowSaveText}>Save ₹{diff} ({pct}%)</Text>
                              </View>
                            </>
                          )}
                        </View>
                        {(it.excludedOptionIds?.length ?? 0) > 0 && (
                          <Text style={styles.addedRowModsHidden}>
                            {it.excludedOptionIds!.length} modifier{it.excludedOptionIds!.length > 1 ? 's' : ''} hidden in this combo
                          </Text>
                        )}
                      </View>
                      <TouchableOpacity
                        onPress={(e) => { e.stopPropagation(); removeItem(idx); }}
                        style={styles.removeItemBtn}
                        activeOpacity={0.7}
                        hitSlop={8}
                      >
                        <Ionicons name="trash-outline" size={16} color={QuinckleColors.danger} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Add items — search + horizontal category tabs + browse list */}
          <View style={styles.browseSection}>
            <Text style={styles.sectionLabel}>Add items</Text>

            <View style={styles.browseSearchWrap}>
              <Ionicons name="search-outline" size={16} color={QuinckleColors.textMuted} />
              <TextInput
                style={styles.browseSearchInput}
                value={browseSearch}
                onChangeText={setBrowseSearch}
                placeholder="Search menu items"
                placeholderTextColor={QuinckleColors.textMuted}
                autoCorrect={false}
              />
              {browseSearch.length > 0 && (
                <TouchableOpacity onPress={() => setBrowseSearch('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={QuinckleColors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {menuCategories.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tabsRow}
                style={isSearching && { opacity: 0.4 }}
                pointerEvents={isSearching ? 'none' : 'auto'}
              >
                {categoryTabs.map(tab => (
                  <TouchableOpacity
                    key={tab}
                    style={[styles.tabChip, activeTab === tab && styles.tabChipActive]}
                    onPress={() => setActiveTab(tab)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.tabChipText, activeTab === tab && styles.tabChipTextActive]}>{tab}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <View style={styles.browseList}>
              {menuLoading ? (
                <ActivityIndicator size="small" color={QuinckleColors.primary} style={{ marginVertical: Spacing.xl }} />
              ) : menuCategories.length === 0 ? (
                <Text style={styles.browseEmpty}>No menu items yet. Add items from the Menu tab first.</Text>
              ) : visibleItems.length === 0 ? (
                <Text style={styles.browseEmpty}>No items match your search.</Text>
              ) : (
                visibleItems.map((item, idx) => {
                  const isAdded = addedNameSet.has(item.name.trim().toLowerCase());
                  return (
                    <View key={item.id} style={[styles.browseRow, idx > 0 && styles.browseRowBorder]}>
                      <VegDot isVeg={item.isVeg} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.browseRowName} numberOfLines={1}>{item.name}</Text>
                        {isSearching && <Text style={styles.browseRowCategory}>{item.categoryName}</Text>}
                        {!item.isAvailable && <Text style={styles.browseRowUnavailable}>Unavailable</Text>}
                      </View>
                      <Text style={styles.browseRowPrice}>₹{parseFloat(item.price).toFixed(0)}</Text>
                      <TouchableOpacity
                        onPress={() => isAdded
                          ? openEditItem(items.findIndex(it => it.name.trim().toLowerCase() === item.name.trim().toLowerCase()))
                          : openAddFromMenu(item)}
                        style={styles.browseAddBtn}
                        activeOpacity={0.7}
                        hitSlop={8}
                      >
                        <Ionicons
                          name={isAdded ? 'checkmark-circle' : 'add-circle-outline'}
                          size={24}
                          color={isAdded ? QuinckleColors.success : QuinckleColors.primary}
                        />
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </View>
          </View>

          {isEdit && <ChangeHistory filter={{ comboId: params.id! }} />}

          {/* Delete button */}
          {isEdit && canDelete && (
            <TouchableOpacity
              style={[styles.deleteBtn, deleting && { opacity: 0.6 }]}
              onPress={deleteCombo}
              disabled={deleting}
              activeOpacity={0.8}
            >
              {deleting ? (
                <ActivityIndicator size="small" color={QuinckleColors.danger} />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={18} color={QuinckleColors.danger} />
                  <Text style={styles.deleteBtnText}>Delete combo</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>

      {/* Full-screen add/edit item price entry — slide+fade overlay, same as offers.tsx */}
      {itemScreenOpen && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { paddingTop: insets.top, backgroundColor: QuinckleColors.background, opacity: itemScreenFade, transform: [{ translateY: itemScreenSlideY }] },
          ]}
        >
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.header}>
              <TouchableOpacity onPress={closeItemScreen} style={styles.headerBtn} activeOpacity={0.7}>
                <Ionicons name="chevron-back" size={22} color={QuinckleColors.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.title}>{itemScreenIdx !== null ? 'Edit item' : 'Add item'}</Text>
              <View style={{ width: 40 }} />
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.huge }]}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.itemScreenNameRow}>
                {itemScreenIsVeg !== null && <VegDot isVeg={itemScreenIsVeg} />}
                <Text style={styles.itemScreenName} numberOfLines={1}>{itemScreenName}</Text>
                <View style={styles.qtyRow}>
                  <TouchableOpacity
                    style={[styles.qtyBtn, itemScreenQty <= 1 && styles.qtyBtnDisabled]}
                    onPress={() => setItemScreenQty(q => Math.max(1, q - 1))}
                    disabled={itemScreenQty <= 1}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="remove" size={16} color={itemScreenQty <= 1 ? QuinckleColors.textMuted : QuinckleColors.textPrimary} />
                  </TouchableOpacity>
                  <Text style={styles.qtyValue}>{itemScreenQty}</Text>
                  <TouchableOpacity
                    style={styles.qtyBtn}
                    onPress={() => setItemScreenQty(q => q + 1)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="add" size={16} color={QuinckleColors.textPrimary} />
                  </TouchableOpacity>
                </View>
              </View>

              {itemScreenAvailable !== null && (
                <View
                  style={[
                    styles.itemScreenBadge,
                    { alignSelf: 'flex-start', backgroundColor: itemScreenAvailable ? QuinckleColors.successSoft : QuinckleColors.dangerSoft },
                  ]}
                >
                  <Text style={[styles.itemScreenBadgeText, { color: itemScreenAvailable ? QuinckleColors.success : QuinckleColors.danger }]}>
                    {itemScreenAvailable ? 'Available' : 'Unavailable'}
                  </Text>
                </View>
              )}

              <Field label="Regular price (₹)">
                <TextInput
                  style={styles.input}
                  value={itemScreenRegularPrice}
                  onChangeText={setItemScreenRegularPrice}
                  placeholder="0"
                  placeholderTextColor={QuinckleColors.textMuted}
                  keyboardType="decimal-pad"
                />
              </Field>

              <Field label="Combo price (₹)">
                <TextInput
                  style={styles.input}
                  value={itemScreenComboPrice}
                  onChangeText={setItemScreenComboPrice}
                  placeholder="0"
                  placeholderTextColor={QuinckleColors.textMuted}
                  keyboardType="decimal-pad"
                />
              </Field>

              <Field label="Takeaway price (₹)">
                <TextInput
                  style={styles.input}
                  value={itemScreenTakeawayPrice}
                  onChangeText={setItemScreenTakeawayPrice}
                  placeholder="Same as combo price"
                  placeholderTextColor={QuinckleColors.textMuted}
                  keyboardType="decimal-pad"
                />
                <Text style={styles.itemScreenFieldHint}>
                  Only used when this combo is ordered for takeaway. Leave blank to charge the combo price.
                </Text>
              </Field>

              {itemScreenQty > 1 && (
                <Text style={styles.itemScreenTotalHint}>
                  Total for {itemScreenQty}: ₹{comboTotal}{regularTotal > comboTotal ? ` (was ₹${regularTotal})` : ''}
                </Text>
              )}

              {priceDiff > 0 && (
                <View style={styles.itemScreenSavingRow}>
                  <Text style={styles.itemScreenSavingText}>Save ₹{priceDiff} ({priceDiffPct}%)</Text>
                </View>
              )}

              {/* Combo modifier toggles — hide options (e.g. paid upgrades) from
                  this combo's diner picker. Diners pick modifiers free inside a
                  combo, so an ON toggle means "included in this deal". */}
              {(() => {
                const groups = itemScreenMenuItemId ? modGroupsByItem[itemScreenMenuItemId] : undefined;
                if (groups === null) {
                  return <ActivityIndicator size="small" color={QuinckleColors.primary} style={{ marginVertical: Spacing.md }} />;
                }
                if (!groups || groups.length === 0) return null;
                return (
                  <View style={styles.modSection}>
                    <View style={styles.modSectionHeader}>
                      <Text style={styles.modSectionTitle}>Modifiers in this combo</Text>
                      {itemScreenExcluded.length > 0 && (
                        <Text style={styles.modSectionHiddenCount}>{itemScreenExcluded.length} hidden</Text>
                      )}
                    </View>
                    {groups.map(g => (
                      <View key={g.id} style={styles.modGroup}>
                        <Text style={styles.modGroupName}>{g.name}</Text>
                        <View style={styles.modChipsRow}>
                          {g.options.map(o => {
                            const on = !itemScreenExcluded.includes(o.id);
                            const adj = parseFloat(o.priceAdjustment) || 0;
                            return (
                              <TouchableOpacity
                                key={o.id}
                                style={[styles.modChip, !on && styles.modChipOff]}
                                onPress={() => toggleExcludedOption(o.id)}
                                activeOpacity={0.7}
                              >
                                <Text style={[styles.modChipText, !on && styles.modChipTextOff]}>
                                  {o.name}
                                </Text>
                                {adj > 0 && (
                                  <Text style={[styles.modChipAdj, !on && styles.modChipTextOff]}>+₹{adj}</Text>
                                )}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    ))}
                    <Text style={styles.modSectionHint}>
                      Diners pick these free inside the combo — tap an option to hide it from this deal.
                    </Text>
                  </View>
                );
              })()}

              <TouchableOpacity
                style={[styles.sheetSaveBtn, !itemScreenName.trim() && { opacity: 0.5 }]}
                onPress={confirmItemScreen}
                disabled={!itemScreenName.trim()}
                activeOpacity={0.85}
              >
                <Text style={styles.sheetSaveText}>{itemScreenIdx !== null ? 'Save item' : 'Add to combo'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </Animated.View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: QuinckleColors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
  },
  headerBtn: { width: 40, height: 40, borderRadius: Radius.pill, justifyContent: 'center', alignItems: 'center' },
  title: { ...Typography.subtitle, color: QuinckleColors.textPrimary },
  saveBtn: {
    backgroundColor: QuinckleColors.primary, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, minWidth: 64, alignItems: 'center',
  },
  saveBtnText: { ...Typography.bodyStrong, color: '#fff' },

  scroll: { padding: Spacing.xl, gap: Spacing.lg },

  imageBanner: {
    height: 180, borderRadius: Radius.lg, overflow: 'hidden',
    backgroundColor: QuinckleColors.surface, borderWidth: 1,
    borderColor: QuinckleColors.border, borderStyle: 'dashed',
  },
  imagePreview: { width: '100%', height: '100%' },
  imagePlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.xs },
  imagePlaceholderText: { ...Typography.caption, color: QuinckleColors.textMuted },
  imageRemove: {
    position: 'absolute', top: Spacing.sm, right: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: Radius.pill,
  },

  field: { gap: Spacing.xs },
  fieldLabel: { ...Typography.label, color: QuinckleColors.textSecondary },
  input: {
    backgroundColor: QuinckleColors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.border,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    ...Typography.body, color: QuinckleColors.textPrimary,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },

  sectionLabel: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary },

  vegBox: { width: 12, height: 12, borderWidth: 1.5, borderRadius: 2, justifyContent: 'center', alignItems: 'center' },
  vegDot: { width: 6, height: 6, borderRadius: 3 },

  // Pricing summary
  summaryCard: {
    borderRadius: Radius.lg, borderWidth: 1, borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surface, padding: Spacing.lg,
  },
  summaryCardWithSavings: { borderColor: QuinckleColors.successBorder, backgroundColor: QuinckleColors.successSoft },
  summaryCardLabel: { ...Typography.label, color: QuinckleColors.textSecondary, marginBottom: Spacing.md },
  summaryCardRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  summaryCardSubLabel: { ...Typography.caption, color: QuinckleColors.textSecondary, marginBottom: 2 },
  summaryCardPrice: { fontSize: 32, fontWeight: '900' as const, color: QuinckleColors.textPrimary, lineHeight: 34 },
  summaryCardOriginal: { ...Typography.caption, color: QuinckleColors.textMuted, textDecorationLine: 'line-through', marginTop: 2 },
  summaryCardPct: { fontSize: 40, fontWeight: '900' as const, color: QuinckleColors.success, lineHeight: 42 },
  summaryCardSaves: { ...Typography.caption, color: QuinckleColors.success, fontWeight: '700', marginTop: 1 },
  summaryCardTakeaway: { ...Typography.caption, color: QuinckleColors.primary, fontWeight: '700', marginTop: 2 },

  // Advanced options card
  advCard: {
    borderRadius: Radius.lg, borderWidth: 1, borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surface, overflow: 'hidden',
  },
  advHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md },
  advHeaderText: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary },
  advDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: QuinckleColors.primary },
  advBody: {
    padding: Spacing.md, paddingTop: 0, gap: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: QuinckleColors.borderSubtle,
  },
  advDivider: { height: StyleSheet.hairlineWidth, backgroundColor: QuinckleColors.borderSubtle },
  advHint: { ...Typography.micro, color: QuinckleColors.textMuted, marginBottom: Spacing.xs, marginTop: 2 },
  advSectionTitle: { ...Typography.label, color: QuinckleColors.textSecondary },
  advSectionSub: { ...Typography.micro, color: QuinckleColors.textMuted, marginTop: 2, lineHeight: 15 },
  advProgress: {
    ...Typography.micro, color: QuinckleColors.textSecondary, marginTop: Spacing.sm,
    borderWidth: 1, borderColor: QuinckleColors.borderSubtle, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, lineHeight: 16,
  },

  // Toggle row (label + switch)
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.xs },
  toggleLabel: { ...Typography.body, color: QuinckleColors.textPrimary },
  toggleSub: { ...Typography.micro, color: QuinckleColors.textMuted, marginTop: 2, lineHeight: 15 },
  switch: {
    width: 44, height: 26, borderRadius: 13, padding: 2,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start',
    backgroundColor: QuinckleColors.surfaceElevated, borderWidth: 1, borderColor: QuinckleColors.border,
  },
  switchOn: { backgroundColor: QuinckleColors.primary, borderColor: QuinckleColors.primary, justifyContent: 'flex-end' },
  switchKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  switchKnobOn: {},

  // Chips (days)
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: 2 },
  chip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.pill, borderWidth: 1, borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surfaceElevated,
  },
  chipActive: { borderColor: QuinckleColors.primary, backgroundColor: QuinckleColors.primarySoft },
  chipText: { ...Typography.caption, color: QuinckleColors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: QuinckleColors.primary },

  // Segmented control (daily cap mode)
  segmented: {
    flexDirection: 'row', borderRadius: Radius.md, borderWidth: 1, borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surfaceElevated, padding: 2, marginBottom: Spacing.xs,
  },
  segment: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.sm, alignItems: 'center' },
  segmentActive: { backgroundColor: QuinckleColors.primary },
  segmentText: { ...Typography.caption, color: QuinckleColors.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: '#fff' },

  itemScreenFieldHint: { ...Typography.micro, color: QuinckleColors.textMuted, marginTop: Spacing.xs, lineHeight: 15 },

  // Added items
  addedSection: { gap: Spacing.sm },
  addedList: {
    backgroundColor: QuinckleColors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: QuinckleColors.border,
  },
  addedRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
  },
  addedRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: QuinckleColors.borderSubtle },
  addedRowName: { ...Typography.body, color: QuinckleColors.textPrimary },
  addedRowPriceLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: 2, flexWrap: 'wrap' },
  addedRowComboPrice: { ...Typography.bodyStrong, color: QuinckleColors.primary },
  addedRowOriginalPrice: { ...Typography.caption, color: QuinckleColors.textMuted, textDecorationLine: 'line-through' },
  addedRowSaveBadge: { backgroundColor: QuinckleColors.successSoft, borderRadius: Radius.pill, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  addedRowSaveText: { ...Typography.micro, color: QuinckleColors.success, fontWeight: '700' },
  removeItemBtn: {
    width: 32, height: 32, borderRadius: Radius.sm,
    backgroundColor: QuinckleColors.dangerSoft, justifyContent: 'center', alignItems: 'center',
  },

  // Browse / add section
  browseSection: { gap: Spacing.sm },
  browseSearchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.md, borderWidth: 1, borderColor: QuinckleColors.border,
    paddingHorizontal: Spacing.md,
  },
  browseSearchInput: { flex: 1, ...Typography.body, color: QuinckleColors.textPrimary, paddingVertical: Spacing.md },
  tabsRow: { gap: Spacing.sm, paddingVertical: 2 },
  tabChip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.pill, borderWidth: 1, borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surface,
  },
  tabChipActive: { borderColor: QuinckleColors.primary, backgroundColor: QuinckleColors.primarySoft },
  tabChipText: { ...Typography.caption, color: QuinckleColors.textSecondary, fontWeight: '600' },
  tabChipTextActive: { color: QuinckleColors.primary },
  browseList: {
    backgroundColor: QuinckleColors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: QuinckleColors.border,
  },
  browseRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
  },
  browseRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: QuinckleColors.borderSubtle },
  browseRowName: { ...Typography.body, color: QuinckleColors.textPrimary },
  browseRowUnavailable: { ...Typography.micro, color: QuinckleColors.danger, marginTop: 1 },
  browseRowCategory: { ...Typography.micro, color: QuinckleColors.textMuted, marginTop: 1 },
  browseRowPrice: { ...Typography.caption, color: QuinckleColors.textSecondary },
  browseAddBtn: { padding: 2 },
  browseEmpty: { ...Typography.caption, color: QuinckleColors.textMuted, fontStyle: 'italic', textAlign: 'center', paddingVertical: Spacing.xl },

  // Full-screen item entry
  itemScreenNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  itemScreenName: { ...Typography.subtitle, color: QuinckleColors.textPrimary, flex: 1 },
  itemScreenBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  itemScreenBadgeText: { ...Typography.caption, color: QuinckleColors.textSecondary, fontWeight: '600' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  qtyBtn: {
    width: 30, height: 30, borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surface, borderWidth: 1, borderColor: QuinckleColors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  qtyBtnDisabled: { opacity: 0.4 },
  qtyValue: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary, minWidth: 24, textAlign: 'center' },
  itemScreenTotalHint: { ...Typography.caption, color: QuinckleColors.textSecondary },
  itemScreenSavingRow: {
    backgroundColor: QuinckleColors.successSoft, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, alignItems: 'center',
  },
  itemScreenSavingText: { ...Typography.bodyStrong, color: QuinckleColors.success },

  addedRowModsHidden: { ...Typography.micro, color: QuinckleColors.primary, marginTop: 3 },

  // Combo modifier toggles (item screen)
  modSection: {
    backgroundColor: QuinckleColors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: QuinckleColors.border,
    padding: Spacing.md, gap: Spacing.md,
  },
  modSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modSectionTitle: { ...Typography.label, color: QuinckleColors.textSecondary },
  modSectionHiddenCount: { ...Typography.micro, color: QuinckleColors.primary, fontWeight: '700' },
  modGroup: { gap: Spacing.xs },
  modGroupName: { ...Typography.caption, color: QuinckleColors.textSecondary, fontWeight: '600' },
  modChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  modChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.pill, borderWidth: 1, borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surfaceElevated,
  },
  modChipOff: { borderColor: QuinckleColors.borderSubtle, backgroundColor: 'transparent', opacity: 0.55 },
  modChipText: { ...Typography.caption, color: QuinckleColors.textPrimary, fontWeight: '600' },
  modChipTextOff: { color: QuinckleColors.textMuted, textDecorationLine: 'line-through' },
  modChipAdj: { ...Typography.micro, color: QuinckleColors.primary, fontWeight: '700' },
  modSectionHint: { ...Typography.micro, color: QuinckleColors.textMuted, lineHeight: 15 },

  sheetSaveBtn: {
    backgroundColor: QuinckleColors.primary, borderRadius: Radius.md,
    paddingVertical: Spacing.md, alignItems: 'center', justifyContent: 'center',
  },
  sheetSaveText: { ...Typography.bodyStrong, color: '#fff' },

  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    marginTop: Spacing.xl, paddingVertical: Spacing.md, borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.dangerBorder, backgroundColor: QuinckleColors.dangerSoft,
  },
  deleteBtnText: { ...Typography.bodyStrong, color: QuinckleColors.danger },
});
