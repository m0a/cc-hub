import { useState, useEffect, useCallback } from 'react';
import * as api from '../services/api';

interface User {
  id: string;
  username: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
}

const TOKEN_KEY = 'cc-hub-token';

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    isLoading: true,
    error: null,
  });

  // Check for existing token on mount
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      api
        .getMe(token)
        .then((data) => {
          setState({
            user: data.user,
            token,
            isLoading: false,
            error: null,
          });
        })
        .catch(() => {
          localStorage.removeItem(TOKEN_KEY);
          setState({
            user: null,
            token: null,
            isLoading: false,
            error: null,
          });
        });
    } else {
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const data = await api.login(username, password);
      localStorage.setItem(TOKEN_KEY, data.token);
      setState({
        user: data.user,
        token: data.token,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Login failed',
      }));
      throw error;
    }
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const data = await api.register(username, password);
      localStorage.setItem(TOKEN_KEY, data.token);
      setState({
        user: data.user,
        token: data.token,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Registration failed',
      }));
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    const token = state.token;
    if (token) {
      try {
        await api.logout(token);
      } catch {
        // Ignore logout errors
      }
    }
    localStorage.removeItem(TOKEN_KEY);
    setState({
      user: null,
      token: null,
      isLoading: false,
      error: null,
    });
  }, [state.token]);

  return {
    user: state.user,
    token: state.token,
    isLoading: state.isLoading,
    error: state.error,
    isAuthenticated: !!state.user,
    login,
    register,
    logout,
  };
}
