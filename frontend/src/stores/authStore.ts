import { create } from 'zustand';
import { User } from '../types';
import { api } from '../services/api';
import { getStoredToken, setStoredToken, removeStoredToken } from '../utils/tokenStorage';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  login: (sessionId: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isLoading: true,
  isAuthenticated: false,

  setUser: (user) => set({ user, isAuthenticated: !!user }),
  
  setToken: (token) => {
    api.setToken(token);
    if (token) {
      setStoredToken(token);
    } else {
      removeStoredToken();
    }
    set({ token });
  },

  login: async (sessionId: string) => {
    try {
      set({ isLoading: true });
      const result = await api.createSession(sessionId);
      await setStoredToken(result.session_token);
      api.setToken(result.session_token);
      set({ 
        user: result.user, 
        token: result.session_token, 
        isAuthenticated: true,
        isLoading: false 
      });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    try {
      await api.logout();
    } catch (error) {
      console.error('Logout error:', error);
    }
    await removeStoredToken();
    api.setToken(null);
    set({ user: null, token: null, isAuthenticated: false });
  },

  checkAuth: async () => {
    try {
      set({ isLoading: true });
      const token = await getStoredToken();
      if (token) {
        api.setToken(token);
        const user = await api.getMe();
        set({ user, token, isAuthenticated: true, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      console.error('Auth check error:', error);
      await removeStoredToken();
      api.setToken(null);
      set({ user: null, token: null, isAuthenticated: false, isLoading: false });
    }
  },

  refreshUser: async () => {
    try {
      const user = await api.getMe();
      set({ user });
    } catch (error) {
      console.error('Refresh user error:', error);
    }
  },
}));
