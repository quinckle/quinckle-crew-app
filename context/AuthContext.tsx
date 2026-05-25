import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setCrewToken, setOn401Callback } from '../services/api';
import type { StaffInfo } from '../services/api';
import { setRealtimeAuth, disconnectRealtime } from '../services/realtime';

type Role = 'staff' | 'cook' | null;

interface AuthContextType {
  role: Role;
  staffInfo: StaffInfo | null;
  crewToken: string | null;
  isRestoring: boolean;
  login: (role: Role, token?: string, staff?: StaffInfo) => void;
  logout: () => void;
  setPhotoUrl: (url: string) => void;
}

// SecureStore keeps the JWT in the iOS Keychain / Android Keystore — readable
// only by this app and not extractable from a routine adb backup. The
// staffInfo blob (name, photo URL, restaurantId) is non-sensitive and stays
// in AsyncStorage so we don't bump up against SecureStore's 2 KB key limit.
// SECURITY_AUDIT.md SEC-7.
const TOKEN_KEY = 'crewToken';
const STAFF_KEY = 'quinckle_crew_staff';
const LEGACY_KEY = 'quinckle_crew_auth'; // pre-SEC-7 AsyncStorage blob

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface Persisted {
  role: Role;
  crewToken: string | null;
  staffInfo: StaffInfo | null;
}

async function loadPersisted(): Promise<Persisted | null> {
  try {
    const [token, staffRaw] = await Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY),
      AsyncStorage.getItem(STAFF_KEY),
    ]);
    if (token && staffRaw) {
      const staff = JSON.parse(staffRaw) as { role: Role; staffInfo: StaffInfo | null };
      return { crewToken: token, role: staff.role, staffInfo: staff.staffInfo };
    }

    // One-time migration from the legacy AsyncStorage blob so existing
    // installs don't get logged out by this rollout. Cleared after migrate.
    const legacy = await AsyncStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (parsed?.crewToken && parsed?.role) {
        await SecureStore.setItemAsync(TOKEN_KEY, parsed.crewToken);
        await AsyncStorage.setItem(STAFF_KEY, JSON.stringify({
          role: parsed.role,
          staffInfo: parsed.staffInfo ?? null,
        }));
        await AsyncStorage.removeItem(LEGACY_KEY);
        return {
          crewToken: parsed.crewToken,
          role: parsed.role,
          staffInfo: parsed.staffInfo ?? null,
        };
      }
    }
  } catch { /* fall through — user just signs in again */ }
  return null;
}

async function persist(role: Role, token: string | null, staffInfo: StaffInfo | null): Promise<void> {
  try {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
    await AsyncStorage.setItem(STAFF_KEY, JSON.stringify({ role, staffInfo }));
  } catch { /* non-fatal; in-memory state still works for this session */ }
}

async function clearPersisted(): Promise<void> {
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {}),
      AsyncStorage.removeItem(STAFF_KEY).catch(() => {}),
      AsyncStorage.removeItem(LEGACY_KEY).catch(() => {}),
    ]);
  } catch { /* non-fatal */ }
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [role, setRole] = useState<Role>(null);
  const [staffInfo, setStaffInfo] = useState<StaffInfo | null>(null);
  const [crewToken, setCrewTokenState] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    loadPersisted()
      .then(saved => {
        if (!saved?.crewToken || !saved.role) return;
        setRole(saved.role);
        setCrewTokenState(saved.crewToken);
        setCrewToken(saved.crewToken);
        if (saved.staffInfo) setStaffInfo(saved.staffInfo);
        if (saved.staffInfo?.id) {
          setRealtimeAuth(saved.crewToken, `crew:${saved.staffInfo.id}`);
        }
      })
      .finally(() => setIsRestoring(false));
  }, []);

  const login = (selectedRole: Role, token?: string, staff?: StaffInfo) => {
    setRole(selectedRole);
    if (token) {
      setCrewTokenState(token);
      setCrewToken(token);
      if (staff?.id) {
        setRealtimeAuth(token, `crew:${staff.id}`);
      }
    }
    if (staff) setStaffInfo(staff);
    void persist(selectedRole, token ?? null, staff ?? null);
  };

  const logout = () => {
    disconnectRealtime();
    setRole(null);
    setStaffInfo(null);
    setCrewTokenState(null);
    setCrewToken(null);
    void clearPersisted();
  };

  const setPhotoUrl = (url: string) => {
    setStaffInfo(prev => {
      const next = prev ? { ...prev, photoUrl: url } : prev;
      if (next) void AsyncStorage.setItem(STAFF_KEY, JSON.stringify({ role, staffInfo: next })).catch(() => {});
      return next;
    });
  };

  // Wire 401 → auto-logout
  useEffect(() => {
    setOn401Callback(logout);
  }, []);

  return (
    <AuthContext.Provider value={{
      role, staffInfo, crewToken, isRestoring, login, logout, setPhotoUrl,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
