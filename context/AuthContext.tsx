import React, { createContext, useContext, useState } from 'react';
import { setCrewToken } from '../services/api';
import type { StaffInfo } from '../services/api';

type Role = 'staff' | 'cook' | null;

interface AuthContextType {
  role: Role;
  staffInfo: StaffInfo | null;
  crewToken: string | null;
  login: (role: Role, token?: string, staff?: StaffInfo) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [role, setRole] = useState<Role>(null);
  const [staffInfo, setStaffInfo] = useState<StaffInfo | null>(null);
  const [crewToken, setCrewTokenState] = useState<string | null>(null);

  const login = (selectedRole: Role, token?: string, staff?: StaffInfo) => {
    setRole(selectedRole);
    if (token) {
      setCrewTokenState(token);
      setCrewToken(token);
    }
    if (staff) setStaffInfo(staff);
  };

  const logout = () => {
    setRole(null);
    setStaffInfo(null);
    setCrewTokenState(null);
    setCrewToken(null);
  };

  return (
    <AuthContext.Provider value={{ role, staffInfo, crewToken, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
