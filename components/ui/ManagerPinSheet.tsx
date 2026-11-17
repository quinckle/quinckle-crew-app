/**
 * Manager PIN approval (POS adjustments, Tier C2).
 *
 * A steward hits an action they are not allowed to do alone; a manager types
 * the PIN on the same device; the action goes through under their approval.
 * The alternative in a real venue is the manager handing over their login,
 * which is precisely what destroys the audit trail.
 *
 * `useManagerApproval` drives the whole thing from the SERVER's answer rather
 * than from what the app believes about roles or policy: run the action, and
 * only if it comes back AUTHORIZATION_REQUIRED do we ask for a PIN and retry.
 * That means admins are never prompted, and a venue that switches a policy off
 * stops being prompted immediately — with no app update.
 */

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { crewAuthorization, type PrivilegedAction } from '../../services/api';
import { QuinckleColors } from '../../constants/Colors';

/** Errors that mean "a PIN would fix this". */
const NEEDS_PIN = new Set(['AUTHORIZATION_REQUIRED', 'ADMIN_REQUIRED']);
/** Errors that mean the grant we just used is no good — ask again, don't loop. */
const GRANT_STALE = new Set(['GRANT_EXPIRED', 'GRANT_ALREADY_USED', 'GRANT_NOT_FOUND', 'GRANT_MISMATCH']);

const ACTION_COPY: Record<PrivilegedAction, string> = {
  COMP_ORDER: 'write this bill off',
  EXEMPT_SESSION: 'clear this whole bill',
  REFUND: 'refund this payment',
  VOID_POST_KOT: 'cancel food the kitchen has already made',
  VOID_AFTER_BILL: 'take items off a bill that has already been printed',
};

/**
 * Mints a grant for ONE adjustment. Grants are single-use, so a batch (freeing
 * a table waives every unpaid order on it) mints one per order — from a single
 * PIN entry, rather than asking the manager once per bill.
 */
export type MintGrant = (scopeRef?: string | null, amount?: number | null) => Promise<string>;

interface Request {
  action: PrivilegedAction;
  amount?: number | null;
  retry: (mint: MintGrant) => Promise<void>;
}

export function useManagerApproval() {
  const [req, setReq] = useState<Request | null>(null);

  /**
   * Run `attempt`. If the backend says authorization is required, prompt for
   * the PIN and run it again — this time handing `attempt` a `mint` it can call
   * per adjustment.
   *
   * Driven by the server's answer, not by the app's idea of who is allowed to
   * do what: `attempt` must surface the API error rather than swallow it.
   */
  const runWithApproval = useCallback(
    async (
      ctx: { action: PrivilegedAction; amount?: number | null },
      attempt: (mint?: MintGrant) => Promise<void>,
    ) => {
      try {
        await attempt();
      } catch (e: any) {
        const code = String(e?.code ?? e?.error ?? '');
        if (!NEEDS_PIN.has(code)) throw e; // not an auth problem — let the caller handle it
        setReq({ ...ctx, retry: (mint) => attempt(mint) });
      }
    },
    [],
  );

  const sheet = (
    <ManagerPinSheet
      request={req}
      onClose={() => setReq(null)}
      onDone={() => setReq(null)}
    />
  );

  return { sheet, runWithApproval };
}

function ManagerPinSheet({
  request, onClose, onDone,
}: { request: Request | null; onClose: () => void; onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Never leave a typed PIN sitting in state between prompts.
  React.useEffect(() => {
    setPin('');
    setError(null);
  }, [request]);

  const submit = async () => {
    if (!request || pin.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Held only for the duration of this submit, then cleared — long enough
      // to mint one grant per bill in a batch, never stored.
      const mint: MintGrant = async (scopeRef, amount) => {
        const res = await crewAuthorization.verifyPin({
          pin,
          action: request.action,
          scopeRef: scopeRef ?? null,
          amount: amount ?? null,
        });
        const id = res?.data?.grantId;
        if (!id) throw new Error('NO_GRANT');
        return id;
      };

      await request.retry(mint);
      setPin('');
      onDone();
    } catch (e: any) {
      const code = String(e?.code ?? '');
      setPin('');
      if (code === 'PIN_LOCKED_OUT') {
        setError('Too many wrong tries. Approvals are locked for 15 minutes.');
      } else if (code === 'INVALID_PIN') {
        setError('That PIN is not right.');
      } else if (GRANT_STALE.has(code)) {
        // Took too long, or someone else spent it. Re-entering is the fix.
        setError('That approval expired. Enter the PIN again.');
      } else {
        setError((typeof e?.message === 'string' && e.message) || 'Could not approve. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const amount = request?.amount;

  return (
    <BottomSheet visible={!!request} onClose={() => { if (!busy) onClose(); }}>
      <View style={styles.body}>
        <View style={styles.icon}>
          <Ionicons name="lock-closed-outline" size={22} color={QuinckleColors.warning} />
        </View>
        <Text style={styles.title}>Manager approval needed</Text>
        <Text style={styles.note}>
          A manager must approve to {request ? ACTION_COPY[request.action] : 'continue'}
          {amount != null && amount > 0 ? ` (₹${Math.round(amount)})` : ''}.
        </Text>

        <TextInput
          style={styles.input}
          value={pin}
          onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 8))}
          placeholder="• • • •"
          placeholderTextColor={QuinckleColors.textMuted}
          keyboardType="number-pad"
          secureTextEntry
          autoFocus
          editable={!busy}
          maxLength={8}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.cancel}
            onPress={() => { if (!busy) onClose(); }}
            activeOpacity={0.8}
            disabled={busy}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.confirm, (pin.length < 4 || busy) && styles.confirmDisabled]}
            onPress={() => void submit()}
            activeOpacity={0.85}
            disabled={pin.length < 4 || busy}
          >
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.confirmText}>Approve</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 22, paddingTop: 4, paddingBottom: 8, alignItems: 'center' },
  icon: {
    width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
    backgroundColor: QuinckleColors.warningSoft, marginBottom: 14,
  },
  title: { fontSize: 17, fontWeight: '800', color: QuinckleColors.textPrimary, marginBottom: 6 },
  note: { fontSize: 13, color: QuinckleColors.textSecondary, textAlign: 'center', lineHeight: 19, paddingHorizontal: 6 },
  input: {
    alignSelf: 'stretch', marginTop: 18, paddingVertical: 14,
    backgroundColor: QuinckleColors.surfaceElevated, borderRadius: 12,
    borderWidth: 1, borderColor: QuinckleColors.border,
    fontSize: 22, letterSpacing: 10, textAlign: 'center', color: QuinckleColors.textPrimary,
  },
  error: { fontSize: 12.5, color: QuinckleColors.danger, marginTop: 10, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 12, alignSelf: 'stretch', marginTop: 20 },
  cancel: {
    flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1,
    borderColor: QuinckleColors.border, alignItems: 'center', justifyContent: 'center',
  },
  cancelText: { fontSize: 14, fontWeight: '700', color: QuinckleColors.textSecondary },
  confirm: {
    flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: QuinckleColors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmDisabled: { opacity: 0.4 },
  confirmText: { fontSize: 14, fontWeight: '800', color: '#fff' },
});
