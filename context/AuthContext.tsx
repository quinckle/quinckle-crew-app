// context/AuthContext.tsx
import React, { createContext, useContext, useState } from 'react';

type Role = 'staff' | 'cook' | null;

interface AuthContextType {
  role: Role;
  login: (selectedRole: Role) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [role, setRole] = useState<Role>(null);

  const login = (selectedRole: Role) => setRole(selectedRole);
  const logout = () => setRole(null);

  return (
    <AuthContext.Provider value={{ role, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};