import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import {
  adminMenu,
  adminModifiers,
  uploadMenuImage,
  type SpiceLevel,
  type MenuItemPayload,
  type ItemChannel,
} from '@/services/menuAdmin';
import { QuinckleColors, Spacing, Radius, Typography } from '@/constants/Colors';
import { AlertProvider, useAlert } from '@/components/menu-admin/AppAlert';
import { useAuth } from '@/context/AuthContext';
import { CAP } from '@/constants/capabilities';
import { ChangeHistory } from '@/components/menu-admin/ChangeHistory';
import AvailabilityScheduleEditor, {
  emptySchedule,
  scheduleFromItem,
  scheduleToPayload,
  validateSchedule,
  type ScheduleValue,
} from '@/components/menu-admin/AvailabilityScheduleEditor';
import { BottomSheet } from '@/components/menu-admin/BottomSheet';

// Sales channels an item can appear on. Crew-only turns the item into a
// staff-added "special charge" (e.g. a birthday fee) that diners never see.
const CHANNEL_OPTIONS: { value: ItemChannel; label: string }[] = [
  { value: 'DINE_IN', label: 'Dine-in' },
  { value: 'TAKEAWAY', label: 'Takeaway' },
  { value: 'CREW', label: 'Crew-only' },
  { value: 'COMBO', label: 'Combo-only' },
];
const DEFAULT_CHANNELS: ItemChannel[] = ['DINE_IN', 'TAKEAWAY'];

const VEG_OPTIONS: { value: boolean; label: string }[] = [
  { value: true, label: 'Veg' },
  { value: false, label: 'Non-veg' },
];

// Standard veg/non-veg square-dot symbol used across the menu list.
function VegDot({ isVeg }: { isVeg: boolean }) {
  return (
    <View style={[styles.vegBox, { borderColor: isVeg ? QuinckleColors.success : QuinckleColors.danger }]}>
      <View style={[styles.vegInner, { backgroundColor: isVeg ? QuinckleColors.success : QuinckleColors.danger }]} />
    </View>
  );
}

// ── Field wrapper ─────────────────────────────────────────────────────────────

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

// ── Main ──────────────────────────────────────────────────────────────────────

// Ported from the partner app; the crew root has no AlertProvider, so each
// menu-admin screen brings its own.
export default function ItemEditScreenRoute() {
  return (
    <AlertProvider>
      <ItemEditScreen />
    </AlertProvider>
  );
}

function ItemEditScreen() {
  const insets = useSafeAreaInsets();
  const alert = useAlert();
  // Deleting is its own capability (MENU_DELETE) — the server refuses it
  // regardless; hiding the control just saves a staffer the 403.
  const canDelete = useAuth().can(CAP.MENU_DELETE);
  const params = useLocalSearchParams<{
    id?: string;
    name?: string;
    description?: string;
    price?: string;
    originalPrice?: string;
    takeawayPrice?: string;
    category?: string;
    isVeg?: string;
    spiceLevel?: string;
    imageUrl?: string;
    channels?: string; // JSON-encoded ItemChannel[]
    schedule?: string; // JSON-encoded availability schedule
    categories?: string; // JSON-encoded string[]
    taxRatePercent?: string;
    taxCategory?: string;
    hsnSac?: string;
  }>();

  const isEdit = !!params.id;

  // Form state
  const [name, setName] = useState(params.name ?? '');
  const [description, setDescription] = useState(params.description ?? '');
  const [price, setPrice] = useState(params.price ?? '');
  const [originalPrice, setOriginalPrice] = useState(params.originalPrice ?? '');
  const [takeawayPrice, setTakeawayPrice] = useState(params.takeawayPrice ?? '');
  const [category, setCategory] = useState(params.category ?? '');
  const [isVeg, setIsVeg] = useState(params.isVeg === 'true');
  const spiceLevel = (params.spiceLevel as SpiceLevel) ?? 'MILD';
  // Per-item GST (Phase 2/3). Empty rate = inherit restaurant default.
  const [taxRatePercent, setTaxRatePercent] = useState(params.taxRatePercent ?? '');
  const [taxCategory, setTaxCategory] = useState<'STANDARD' | 'EXEMPT' | 'NIL' | 'NON_GST'>(
    (params.taxCategory as any) || 'STANDARD',
  );
  const [hsnSac, setHsnSac] = useState(params.hsnSac ?? '');
  const [imageUri, setImageUri] = useState<string | null>(params.imageUrl ?? null);
  const [imageChanged, setImageChanged] = useState(false);

  // Sales channels. Legacy items (empty/absent) fall back to the default set so
  // the item stays visible where it always was.
  const [channels, setChannels] = useState<ItemChannel[]>(() => {
    try {
      const parsed = params.channels ? (JSON.parse(params.channels) as ItemChannel[]) : [];
      return parsed.length > 0 ? parsed : DEFAULT_CHANNELS;
    } catch {
      return DEFAULT_CHANNELS;
    }
  });

  // Toggle a channel, but never allow an empty set — an item with no channels
  // would be invisible everywhere.
  const toggleChannel = (value: ItemChannel) => {
    Haptics.selectionAsync();
    setChannels((prev) => {
      const next = prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value];
      return next.length > 0 ? next : prev;
    });
  };

  // Availability schedule. Arrives as one JSON param (route params are strings)
  // and is parsed defensively — a malformed blob must not block editing a dish.
  const [schedule, setSchedule] = useState<ScheduleValue>(() => {
    try {
      return params.schedule ? scheduleFromItem(JSON.parse(params.schedule)) : emptySchedule();
    } catch {
      return emptySchedule();
    }
  });

  const [categories, setCategories] = useState<string[]>([]);
  const [showCatPicker, setShowCatPicker] = useState(false);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Load existing categories for the picker
  useEffect(() => {
    if (params.categories) {
      try { setCategories(JSON.parse(params.categories)); } catch { /* ignore */ }
    }
  }, [params.categories]);

  // Modifier group count, shown as a badge on the Modifiers row.
  const [modifierGroupCount, setModifierGroupCount] = useState<number | null>(null);
  useEffect(() => {
    if (!params.id) return;
    adminModifiers.getGroups(params.id)
      .then((groups) => setModifierGroupCount(groups.length))
      .catch(() => {});
  }, [params.id]);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      alert.info('Allow access to your photo library to add a dish image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [5, 6], // portrait — matches the diner menu card (250×300, 5:6)
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      setImageChanged(true);
    }
  };

  const removeImage = () => {
    setImageUri(null);
    setImageChanged(true);
  };

  const validate = () => {
    if (!name.trim()) { alert.error('Item name is required.'); return false; }
    if (!price.trim() || isNaN(parseFloat(price)) || parseFloat(price) < 0) {
      alert.error('Enter a valid price.'); return false;
    }
    if (!category.trim()) { alert.error('Select or enter a category.'); return false; }
    // Mirrors the server guard so a bad schedule is caught here, not as a 400.
    const scheduleError = validateSchedule(schedule);
    if (scheduleError) { alert.error(scheduleError); return false; }
    return true;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      // Coerce a blank imageUrl to undefined so it's dropped from the payload.
      // Photo-less items carry "" from params; sending it would fail the
      // backend's `format:"uri"` validation (400 → shown as a server error).
      let finalImageUrl: string | null | undefined = imageUri?.trim() ? imageUri : undefined;

      if (imageChanged && imageUri) {
        setUploadingImage(true);
        const ext = imageUri.split('.').pop() ?? 'jpg';
        const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
        finalImageUrl = await uploadMenuImage(imageUri, mime);
        setUploadingImage(false);
      } else if (imageChanged && !imageUri) {
        // Explicit null (not undefined) so the key survives JSON.stringify
        // and reaches the backend, which treats null as "clear the image".
        finalImageUrl = null;
      }

      const payload: MenuItemPayload = {
        name: name.trim(),
        description: description.trim() || undefined,
        price: parseFloat(price),
        originalPrice: originalPrice.trim() ? parseFloat(originalPrice) : null,
        takeawayPrice:
          takeawayPrice.trim() && !isNaN(parseFloat(takeawayPrice)) && parseFloat(takeawayPrice) > 0
            ? parseFloat(takeawayPrice)
            : null,
        category: category.trim(),
        isVeg,
        spiceLevel,
        imageUrl: finalImageUrl,
        channels,
        taxRatePercent:
          taxRatePercent.trim() && !isNaN(parseInt(taxRatePercent, 10))
            ? parseInt(taxRatePercent, 10)
            : null,
        taxCategory: taxCategory !== 'STANDARD' ? taxCategory : null,
        hsnSac: hsnSac.trim() || null,
        ...scheduleToPayload(schedule),
      };

      if (isEdit && params.id) {
        await adminMenu.updateItem(params.id, payload);
      } else {
        await adminMenu.createItem(payload);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e: any) {
      setUploadingImage(false);
      alert.error(e.message ?? 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = () => {
    alert.confirm(
      'Delete item',
      `Remove "${name}" from your menu? This cannot be undone.\n\nNote: items that appear in existing orders cannot be deleted — mark them unavailable instead.`,
      async () => {
        setDeleting(true);
        try {
          await adminMenu.deleteItem(params.id!);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
        } catch (e: any) {
          const msg = e.message?.includes('MENU_ITEM_HAS_ORDERS')
            ? 'This item appears in existing orders. Mark it unavailable instead of deleting.'
            : (e.message ?? 'Failed to delete item.');
          alert.error(msg);
        } finally {
          setDeleting(false);
        }
      },
      { danger: true, confirmText: 'Delete' }
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>{isEdit ? 'Edit Item' : 'New Item'}</Text>
          <TouchableOpacity
            onPress={save}
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            disabled={saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.saveBtnText}>{uploadingImage ? 'Uploading…' : 'Save'}</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.huge }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Image picker */}
          <TouchableOpacity style={styles.imagePicker} onPress={pickImage} activeOpacity={0.8}>
            {imageUri ? (
              <>
                <Image source={{ uri: imageUri }} style={styles.imagePreview} />
                <TouchableOpacity style={styles.imageRemove} onPress={removeImage}>
                  <Ionicons name="close-circle" size={24} color="#fff" />
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.imagePlaceholder}>
                <Ionicons name="camera-outline" size={28} color={QuinckleColors.textMuted} />
                <Text style={styles.imagePlaceholderText}>Add photo</Text>
              </View>
            )}
          </TouchableOpacity>
          <Text style={styles.imageHint}>
            Diners see this as a portrait card — 5:6, ideally 1000×1200px. Centre the dish; the top & bottom edges may be cropped.
          </Text>

          {/* Name */}
          <Field label="Name" required>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Paneer Tikka"
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
              placeholder="Short description (optional)"
              placeholderTextColor={QuinckleColors.textMuted}
              multiline
              numberOfLines={3}
              autoCorrect={false}
            />
          </Field>

          {/* Category */}
          <Field label="Category" required>
            <TouchableOpacity
              style={styles.input}
              onPress={() => setShowCatPicker(true)}
              activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[styles.inputText, !category && { color: QuinckleColors.textMuted }]}>
                  {category || 'Select or type a category'}
                </Text>
                <Ionicons name="chevron-down" size={16} color={QuinckleColors.textMuted} />
              </View>
            </TouchableOpacity>
          </Field>

          {/* Price row */}
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field label="Price (₹)" required>
                <TextInput
                  style={styles.input}
                  value={price}
                  onChangeText={setPrice}
                  placeholder="0"
                  placeholderTextColor={QuinckleColors.textMuted}
                  keyboardType="decimal-pad"
                />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Original price (₹)">
                <TextInput
                  style={styles.input}
                  value={originalPrice}
                  onChangeText={setOriginalPrice}
                  placeholder="For strikethrough"
                  placeholderTextColor={QuinckleColors.textMuted}
                  keyboardType="decimal-pad"
                />
              </Field>
            </View>
          </View>

          {/* Takeaway price — only relevant when the item is sold via takeaway */}
          {channels.includes('TAKEAWAY') && (
            <Field label="Takeaway price (₹) — optional">
              <TextInput
                style={styles.input}
                value={takeawayPrice}
                onChangeText={setTakeawayPrice}
                placeholder="Same as price when empty"
                placeholderTextColor={QuinckleColors.textMuted}
                keyboardType="decimal-pad"
              />
              <Text style={styles.channelHint}>
                Takeaway orders use this price; dine-in keeps the regular price. Leave empty for the same price on both.
              </Text>
            </Field>
          )}

          {/* Per-item GST (Phase 2/3) — optional; inherits restaurant default */}
          <Field label="GST rate — optional">
            <View style={[styles.channelRow, { flexWrap: 'wrap' }]}>
              {[
                { label: 'Default', value: '' },
                { label: '0%', value: '0' },
                { label: '5%', value: '5' },
                { label: '12%', value: '12' },
                { label: '18%', value: '18' },
                { label: '28%', value: '28' },
              ].map((opt) => {
                const active = taxRatePercent === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value || 'default'}
                    style={[styles.channelChip, active && styles.channelChipActive]}
                    onPress={() => { Haptics.selectionAsync(); setTaxRatePercent(opt.value); }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.channelChipText, active && styles.channelChipTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.channelHint}>
              Leave on Default to use your restaurant GST rate. Set a specific rate for differently-taxed items.
            </Text>
          </Field>

          <Field label="Tax category">
            <View style={[styles.channelRow, { flexWrap: 'wrap' }]}>
              {[
                { label: 'Standard', value: 'STANDARD' },
                { label: 'Exempt', value: 'EXEMPT' },
                { label: 'Nil-rated', value: 'NIL' },
                { label: 'Non-GST', value: 'NON_GST' },
              ].map((opt) => {
                const active = taxCategory === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.channelChip, active && styles.channelChipActive]}
                    onPress={() => { Haptics.selectionAsync(); setTaxCategory(opt.value as any); }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.channelChipText, active && styles.channelChipTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Field>

          <Field label="HSN / SAC code — optional">
            <TextInput
              style={styles.input}
              value={hsnSac}
              onChangeText={setHsnSac}
              placeholder="e.g. 996331"
              placeholderTextColor={QuinckleColors.textMuted}
              autoCapitalize="characters"
              maxLength={10}
            />
          </Field>

          {/* Veg / Non-veg */}
          <Field label="Veg / Non-veg">
            <View style={styles.channelRow}>
              {VEG_OPTIONS.map((opt) => {
                const active = isVeg === opt.value;
                return (
                  <TouchableOpacity
                    key={String(opt.value)}
                    style={[styles.channelChip, styles.vegChip, active && styles.channelChipActive]}
                    onPress={() => { Haptics.selectionAsync(); setIsVeg(opt.value); }}
                    activeOpacity={0.8}
                  >
                    <VegDot isVeg={opt.value} />
                    <Text style={[styles.channelChipText, active && styles.channelChipTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Field>

          {/* Sales channels — where this item is available. Crew-only makes it a
              staff-added "special charge" (e.g. birthday fee) hidden from diners. */}
          <Field label="Available on">
            <View style={styles.channelRow}>
              {CHANNEL_OPTIONS.map((opt) => {
                const active = channels.includes(opt.value);
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.channelChip, active && styles.channelChipActive]}
                    onPress={() => toggleChannel(opt.value)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.channelChipText, active && styles.channelChipTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.channelHint}>
              Pick <Text style={styles.channelHintAccent}>Crew-only</Text> to make a staff-added charge
              (e.g. a birthday fee) that diners never see.
            </Text>
          </Field>

          {/* Availability schedule — when this dish can actually be ordered.
              Available on create too, so a breakfast-only dish is set up in one
              pass instead of saved and then edited. */}
          <AvailabilityScheduleEditor value={schedule} onChange={setSchedule} />

          {/* Modifiers (edit mode only) */}
          {isEdit && (
            <TouchableOpacity
              style={styles.modifiersRow}
              onPress={() => router.push({ pathname: '/(staff)/menu-modifiers', params: { itemId: params.id!, itemName: name } })}
              activeOpacity={0.7}
            >
              <View style={styles.modifiersIcon}>
                <Ionicons name="options-outline" size={18} color={QuinckleColors.textPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
                  <Text style={styles.switchLabel}>Modifiers</Text>
                  {!!modifierGroupCount && (
                    <View style={styles.modifierCountBadge}>
                      <Text style={styles.modifierCountBadgeText}>{modifierGroupCount}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.switchSub}>Size, toppings, add-ons, etc.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={QuinckleColors.textMuted} />
            </TouchableOpacity>
          )}

          {isEdit && <ChangeHistory filter={{ itemId: params.id! }} />}

          {/* Delete button (edit mode only) */}
          {isEdit && canDelete && (
            <TouchableOpacity
              style={[styles.deleteBtn, deleting && { opacity: 0.6 }]}
              onPress={deleteItem}
              disabled={deleting}
              activeOpacity={0.8}
            >
              {deleting ? (
                <ActivityIndicator size="small" color={QuinckleColors.danger} />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={18} color={QuinckleColors.danger} />
                  <Text style={styles.deleteBtnText}>Delete item</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>

      <BottomSheet
        visible={showCatPicker}
        onClose={() => setShowCatPicker(false)}
        title="Select category"
      >
        <View style={styles.catSheetBody}>
          {categories.length === 0 ? (
            <Text style={styles.catEmptyText}>No categories yet. Add one from the menu screen’s + button.</Text>
          ) : (
            categories.map(c => (
              <TouchableOpacity
                key={c}
                style={[styles.catOption, category === c && styles.catOptionSelected]}
                onPress={() => { setCategory(c); setShowCatPicker(false); }}
              >
                <Text style={[styles.catOptionText, category === c && { color: QuinckleColors.primary }]}>{c}</Text>
                {category === c && <Ionicons name="checkmark" size={16} color={QuinckleColors.primary} />}
              </TouchableOpacity>
            ))
          )}
        </View>
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: QuinckleColors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  headerBtn: {
    width: 40, height: 40,
    borderRadius: Radius.pill,
    justifyContent: 'center', alignItems: 'center',
  },
  title: { ...Typography.subtitle, color: QuinckleColors.textPrimary },
  saveBtn: {
    backgroundColor: QuinckleColors.primary,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    minWidth: 64,
    alignItems: 'center',
  },
  saveBtnText: { ...Typography.bodyStrong, color: '#fff' },

  scroll: { padding: Spacing.xl, gap: Spacing.lg },

  imagePicker: {
    alignSelf: 'center',
    width: 150,
    aspectRatio: 5 / 6, // portrait — mirrors the diner menu card so the crop is WYSIWYG
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    borderStyle: 'dashed',
  },
  imagePreview: { width: '100%', height: '100%' },
  imageHint: {
    ...Typography.micro,
    color: QuinckleColors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  imagePlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.xs },
  imagePlaceholderText: { ...Typography.caption, color: QuinckleColors.textMuted },
  imageRemove: {
    position: 'absolute', top: Spacing.sm, right: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: Radius.pill,
  },

  field: { gap: Spacing.xs },
  fieldLabel: { ...Typography.label, color: QuinckleColors.textSecondary },

  input: {
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    ...Typography.body,
    color: QuinckleColors.textPrimary,
  },
  inputText: { ...Typography.body, color: QuinckleColors.textPrimary },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },

  catSheetBody: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.lg, gap: Spacing.xs },
  catOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: QuinckleColors.borderSubtle,
  },
  catOptionSelected: { backgroundColor: QuinckleColors.primarySoft },
  catOptionText: { ...Typography.body, color: QuinckleColors.textPrimary },
  catEmptyText: { ...Typography.caption, color: QuinckleColors.textMuted, fontStyle: 'italic', paddingVertical: Spacing.md },

  row: { flexDirection: 'row', gap: Spacing.md },

  channelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  channelChip: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  channelChipActive: {
    borderColor: QuinckleColors.primary,
    backgroundColor: QuinckleColors.primarySoft,
  },
  channelChipText: { ...Typography.caption, color: QuinckleColors.textSecondary },
  channelChipTextActive: { color: QuinckleColors.primary, fontWeight: '600' },
  channelHint: { ...Typography.micro, color: QuinckleColors.textMuted, marginTop: Spacing.xs },
  channelHintAccent: { color: QuinckleColors.primary, fontWeight: '600' },

  vegChip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  vegBox: { width: 11, height: 11, borderWidth: 1.5, borderRadius: 2, justifyContent: 'center', alignItems: 'center' },
  vegInner: { width: 5, height: 5, borderRadius: 3 },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  switchLabel: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary },
  switchSub: { ...Typography.micro, color: QuinckleColors.textSecondary, marginTop: 2 },

  modifiersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  modifiersIcon: {
    width: 36, height: 36,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceElevated,
    alignItems: 'center', justifyContent: 'center',
  },
  modifierCountBadge: {
    minWidth: 18, height: 18,
    borderRadius: Radius.pill,
    backgroundColor: QuinckleColors.primary,
    paddingHorizontal: 5,
    alignItems: 'center', justifyContent: 'center',
  },
  modifierCountBadgeText: { ...Typography.micro, color: '#fff', fontWeight: '700' },

  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.dangerBorder,
    backgroundColor: QuinckleColors.dangerSoft,
  },
  deleteBtnText: { ...Typography.bodyStrong, color: QuinckleColors.danger },
});
