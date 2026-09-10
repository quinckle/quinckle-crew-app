import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet, Text, View, ScrollView, TextInput, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { crewMemberships, type CrewMembershipTier, type CrewMember } from '../services/api';
import { QuinckleColors } from '../constants/Colors';

export default function Memberships() {
  const insets = useSafeAreaInsets();

  const [tiers, setTiers] = useState<CrewMembershipTier[]>([]);
  const [members, setMembers] = useState<CrewMember[]>([]);
  const [loading, setLoading] = useState(true);

  // enrol form
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [tierId, setTierId] = useState<string | null>(null);
  const [lookupHint, setLookupHint] = useState<{ text: string; warn: boolean } | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const userTypedName = React.useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, m] = await Promise.all([crewMemberships.tiers(), crewMemberships.members()]);
      const tierList = t?.data ?? [];
      setTiers(tierList);
      setMembers(m?.data ?? []);
      setTierId(prev => prev ?? (tierList[0]?.id ?? null));
    } catch { /* surfaced via empty state */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Debounced phone lookup → auto-fill name + already-member warning
  useEffect(() => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) { setLookupHint(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await crewMemberships.lookup(phone);
        if (cancelled || !res?.data) return;
        const d = res.data;
        if (d.alreadyMember) setLookupHint({ text: 'Already a member here', warn: true });
        else if (d.exists) { setLookupHint({ text: 'Existing Quinckle diner', warn: false }); if (d.name && !userTypedName.current) setName(d.name); }
        else setLookupHint(null);
      } catch { /* ignore */ }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [phone]);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  const enrol = async () => {
    if (phone.replace(/\D/g, '').length < 10) { flash('Enter a valid phone number'); return; }
    if (!tierId) { flash('Pick a tier'); return; }
    setEnrolling(true);
    try {
      const res = await crewMemberships.enrol({ phone, name: name.trim() || null, membershipId: tierId });
      if (!res?.success) { flash((res as any)?.error ?? 'Could not enrol'); return; }
      flash('Member enrolled ✓');
      setPhone(''); setName(''); setLookupHint(null); userTypedName.current = false;
      await load();
    } catch (e: any) {
      flash(e?.error || e?.message || 'Could not enrol');
    } finally { setEnrolling(false); }
  };

  const tierLabel = (t: CrewMembershipTier) =>
    `${t.name} · ${t.discountType === 'PERCENTAGE' ? `${t.discountValue}%` : `₹${t.discountValue}`}`;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.headerBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Memberships</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={QuinckleColors.primary} /></View>
      ) : tiers.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="ribbon-outline" size={34} color={QuinckleColors.textTertiary} />
          <Text style={styles.emptyTitle}>No membership tiers yet</Text>
          <Text style={styles.emptySub}>Ask the owner to create a tier from the web dashboard, then you can enrol customers here.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
          {/* Enrol form */}
          <Text style={styles.sectionLabel}>Enrol a customer</Text>

          <Text style={styles.fieldLabel}>Phone number</Text>
          <TextInput
            value={phone}
            onChangeText={(v) => setPhone(v.replace(/[^0-9+ ]/g, ''))}
            keyboardType="phone-pad"
            placeholder="98765 43210"
            placeholderTextColor={QuinckleColors.textMuted}
            style={styles.input}
          />
          {lookupHint && (
            <Text style={[styles.hint, { color: lookupHint.warn ? '#f59e0b' : QuinckleColors.success }]}>{lookupHint.text}</Text>
          )}

          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Name (optional)</Text>
          <TextInput
            value={name}
            onChangeText={(v) => { userTypedName.current = true; setName(v); }}
            placeholder="Customer name"
            placeholderTextColor={QuinckleColors.textMuted}
            style={styles.input}
          />

          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Tier</Text>
          <View style={styles.tierWrap}>
            {tiers.map(t => {
              const sel = t.id === tierId;
              return (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setTierId(t.id)}
                  activeOpacity={0.8}
                  style={[styles.tierChip, sel && styles.tierChipSel]}
                >
                  <Text style={[styles.tierChipText, sel && styles.tierChipTextSel]}>{tierLabel(t)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            onPress={enrol}
            disabled={enrolling}
            activeOpacity={0.85}
            style={[styles.enrolBtn, enrolling && { opacity: 0.6 }]}
          >
            {enrolling ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.enrolBtnText}>Enrol member</Text>}
          </TouchableOpacity>

          {/* Members list */}
          <Text style={[styles.sectionLabel, { marginTop: 30 }]}>
            Members{members.length ? ` (${members.length})` : ''}
          </Text>
          {members.length === 0 ? (
            <Text style={styles.emptySub}>No members yet — enrol your first above.</Text>
          ) : (
            members.map(m => (
              <View key={m.id} style={styles.memberRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{m.name || m.phone}</Text>
                  <Text style={styles.memberSub}>{m.phone} · {m.membershipName ?? '—'}</Text>
                </View>
                {m.status !== 'ACTIVE' && <Text style={styles.pausedTag}>Paused</Text>}
              </View>
            ))
          )}
        </ScrollView>
      )}

      {toast && (
        <View style={[styles.toast, { bottom: insets.bottom + 24 }]}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: QuinckleColors.background },
  headerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: QuinckleColors.border },
  backBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: QuinckleColors.textPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: QuinckleColors.textPrimary, marginTop: 6 },
  emptySub: { fontSize: 13, color: QuinckleColors.textSecondary, textAlign: 'center', lineHeight: 19, marginTop: 4 },
  sectionLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', color: QuinckleColors.textTertiary, marginBottom: 12 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: QuinckleColors.textSecondary, marginBottom: 7 },
  input: { backgroundColor: QuinckleColors.surface, borderWidth: 1, borderColor: QuinckleColors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: QuinckleColors.textPrimary },
  hint: { fontSize: 12, fontWeight: '600', marginTop: 6 },
  tierWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tierChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 11, borderWidth: 1, borderColor: QuinckleColors.border, backgroundColor: QuinckleColors.surface },
  tierChipSel: { borderColor: QuinckleColors.primary, backgroundColor: 'rgba(243,93,59,0.10)' },
  tierChipText: { fontSize: 13.5, fontWeight: '600', color: QuinckleColors.textSecondary },
  tierChipTextSel: { color: QuinckleColors.textPrimary },
  enrolBtn: { marginTop: 22, backgroundColor: QuinckleColors.primary, borderRadius: 13, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  enrolBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  memberRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: QuinckleColors.surface, borderWidth: 1, borderColor: QuinckleColors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 9 },
  memberName: { fontSize: 14.5, fontWeight: '700', color: QuinckleColors.textPrimary },
  memberSub: { fontSize: 12.5, color: QuinckleColors.textSecondary, marginTop: 2 },
  pausedTag: { fontSize: 11, fontWeight: '700', color: '#f59e0b' },
  toast: { position: 'absolute', alignSelf: 'center', backgroundColor: QuinckleColors.surfaceElevated, borderWidth: 1, borderColor: QuinckleColors.borderStrong, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12 },
  toastText: { color: QuinckleColors.textPrimary, fontSize: 13.5, fontWeight: '700' },
});
