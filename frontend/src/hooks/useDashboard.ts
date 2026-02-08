import { useState, useCallback, useEffect } from 'react';
import type { DashboardResponse } from '../../../shared/types';
import { authFetch, isTimeoutError } from '../services/api';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface UseDashboardReturn {
  data: DashboardResponse | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useDashboard(refreshInterval: number = 60000): UseDashboardReturn {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await authFetch(`${API_BASE}/api/dashboard`);
      if (!response.ok) {
        throw new Error('Failed to fetch dashboard data');
      }
      const result = await response.json();
      setData(result);
    } catch (err) {
      if (!isTimeoutError(err)) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
      // Keep previous data on error (don't setData(null))
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();

    // Auto-refresh at interval
    const interval = setInterval(fetchDashboard, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchDashboard, refreshInterval]);

  return {
    data,
    isLoading,
    error,
    refetch: fetchDashboard,
  };
}
