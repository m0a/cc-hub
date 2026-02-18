import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

interface LoginFormProps {
  onLogin: (password: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function LoginForm({ onLogin, isLoading, error }: LoginFormProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await onLogin(password);
    } catch {
      // Error is handled by parent
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-th-bg">
      <div className="bg-th-surface p-8 rounded-lg shadow-xl w-full max-w-md">
        <h1 className="text-2xl font-bold text-th-text mb-6 text-center">
          CC Hub
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-th-text-secondary mb-1">
              {t('auth.password')}
            </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 bg-th-surface-hover border border-th-border rounded-lg text-th-text focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              disabled={isLoading}
            />
          </div>

          {error && (
            <div className="text-red-400 text-sm bg-red-900/20 p-3 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-800 disabled:cursor-not-allowed text-th-text font-medium rounded-lg transition-colors"
          >
            {isLoading ? t('auth.authenticating') : t('auth.login')}
          </button>
        </form>
      </div>
    </div>
  );
}
