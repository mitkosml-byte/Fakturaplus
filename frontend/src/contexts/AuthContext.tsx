import React, { createContext, useContext, useEffect, ReactNode, useMemo } from 'react';
import { useAuthStore } from '../stores/authStore';
import { User } from '../types';

// Role hierarchy: owner > manager > staff
export type UserRole = 'owner' | 'manager' | 'staff';

// Permission types
export type Permission = 
  | 'manage_users'      // Invite, remove users, change roles
  | 'manage_company'    // Edit company settings
  | 'view_audit_log'    // View audit logs
  | 'manage_budget'     // Create/edit budgets
  | 'export_data'       // Export to Excel/PDF
  | 'view_statistics'   // View advanced statistics
  | 'manage_invoices'   // Create/edit/delete invoices
  | 'add_revenue'       // Add daily revenue
  | 'add_expenses';     // Add expenses

// Role-permission matrix
const rolePermissions: Record<UserRole, Permission[]> = {
  owner: [
    'manage_users',
    'manage_company', 
    'view_audit_log',
    'manage_budget',
    'export_data',
    'view_statistics',
    'manage_invoices',
    'add_revenue',
    'add_expenses',
  ],
  manager: [
    'manage_budget',
    'export_data',
    'view_statistics',
    'manage_invoices',
    'add_revenue',
    'add_expenses',
  ],
  staff: [
    'manage_invoices',
    'add_revenue',
    'add_expenses',
  ],
};

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (sessionId: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUser: (user: User | null) => void;
  // Role helpers
  hasPermission: (permission: Permission) => boolean;
  hasRole: (role: UserRole) => boolean;
  isOwner: boolean;
  isManager: boolean;
  isStaff: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { user, isLoading, isAuthenticated, login, logout, checkAuth, refreshUser, setUser } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated, login, logout, refreshUser, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
