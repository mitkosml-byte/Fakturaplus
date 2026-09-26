import React, { createContext, useContext, useEffect, ReactNode, useMemo } from 'react';
import { useAuthStore } from '../stores/authStore';
import { User } from '../types';
import type { Permission } from '../utils/permissions';

// Role hierarchy: owner > manager > staff. "accountant" sits outside this
// hierarchy - an external, cross-company role rather than a rung on it.
export type UserRole = 'owner' | 'manager' | 'staff' | 'accountant';

// Permission types - re-exported from utils/permissions.ts, which also
// holds the role defaults/ceilings used by the owner's permissions
// checklist (invite screen, Users Management).
export type { Permission } from '../utils/permissions';

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
  isAccountant: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { user, isLoading, isAuthenticated, login, logout, checkAuth, refreshUser, setUser } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, []);

  // Role-based permission helpers
  const roleHelpers = useMemo(() => {
    const userRole = (user?.role || 'staff') as UserRole;
    
    // Sourced from the backend (user.permissions), not derived from role
    // here - the owner can fine-tune an individual member's permissions
    // beyond their role's defaults via the permissions checklist, and this
    // must reflect exactly what the server will actually enforce.
    const hasPermission = (permission: Permission): boolean => {
      if (!user) return false;
      return (user.permissions || []).includes(permission);
    };
    
    const hasRole = (role: UserRole): boolean => {
      if (!user) return false;
      // "accountant" is a lateral role outside the owner > manager > staff
      // ladder, not a rung on it - only an exact match counts.
      if (userRole === 'accountant' || role === 'accountant') {
        return userRole === role;
      }
      const roleHierarchy: UserRole[] = ['owner', 'manager', 'staff'];
      const userRoleIndex = roleHierarchy.indexOf(userRole);
      const requiredRoleIndex = roleHierarchy.indexOf(role);
      return userRoleIndex <= requiredRoleIndex;
    };

    return {
      hasPermission,
      hasRole,
      isOwner: userRole === 'owner',
      isManager: userRole === 'manager',
      isStaff: userRole === 'staff',
      isAccountant: userRole === 'accountant',
    };
  }, [user]);

  return (
    <AuthContext.Provider value={{ 
      user, 
      isLoading, 
      isAuthenticated, 
      login, 
      logout, 
      refreshUser, 
      setUser,
      ...roleHelpers
    }}>
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
