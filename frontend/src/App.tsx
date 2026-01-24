import { useState, useCallback, useEffect } from 'react';
import { TerminalPage } from './pages/TerminalPage';
import { SessionList } from './components/SessionList';

const API_BASE = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`;

export function App() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showSessionList, setShowSessionList] = useState(false);

  // On mount, fetch sessions and auto-select the most recent one
  useEffect(() => {
    const fetchAndSelectSession = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/sessions`);
        if (response.ok) {
          const data = await response.json();
          // Sessions are sorted by lastAccessedAt descending
          if (data.sessions.length > 0) {
            setSelectedSessionId(data.sessions[0].id);
          } else {
            setShowSessionList(true);
          }
        } else {
          setShowSessionList(true);
        }
      } catch {
        setShowSessionList(true);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAndSelectSession();
  }, []);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    setShowSessionList(false);
  }, []);

  const handleBackToList = useCallback(() => {
    setShowSessionList(true);
  }, []);

  // Show loading while fetching initial session
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  // Show session list if explicitly requested or no session selected
  if (showSessionList || !selectedSessionId) {
    return <SessionList onSelectSession={handleSelectSession} />;
  }

  // Show terminal with selected session
  return (
    <TerminalPage
      sessionId={selectedSessionId}
      onBackToList={handleBackToList}
    />
  );
}
