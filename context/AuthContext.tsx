import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setCrewToken, setOn401Callback } from '../services/api';
import type { StaffInfo } from '../services/api';

type Role = 'staff' | 'cook' | null;

interface AuthContextType {
  role: Role;
  staffInfo: StaffInfo | null;
  crewToken: string | null;
  isRestoring: boolean;
  login: (role: Role, token?: string, staff?: StaffInfo) => void;
  logout: () => void;
}

const STORAGE_KEY = 'quinckle_crew_auth';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [role, setRole] = useState<Role>(null);
  const [staffInfo, setStaffInfo] = useState<StaffInfo | null>(null);
  const [crewToken, setCrewTokenState] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  // Restore auth on app start
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => {
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (saved.crewToken && saved.role) {
          setRole(saved.role);
          setCrewTokenState(saved.crewToken);
          setCrewToken(saved.crewToken);
          if (saved.staffInfo) setStaffInfo(saved.staffInfo);
        }
      })
      .catch(() => {})
      .finally(() => setIsRestoring(false));
  }, []);

  const login = (selectedRole: Role, token?: string, staff?: StaffInfo) => {
    setRole(selectedRole);
    if (token) {
      setCrewTokenState(token);
      setCrewToken(token);
    }
    if (staff) setStaffInfo(staff);
    // Persist to storage
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ role: selectedRole, crewToken: token ?? null, staffInfo: staff ?? null })).catch(() => {});
  };

  const logout = () => {
    setRole(null);
    setStaffInfo(null);
    setCrewTokenState(null);
    setCrewToken(null);
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  };

  // Wire 401 → auto-logout
  useEffect(() => {
    setOn401Callback(logout);
  }, []);

  return (
    <AuthContext.Provider value={{ role, staffInfo, crewToken, isRestoring, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
