import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initRemoteLogger } from './utils/remoteLogger';
import './index.css';

// Initialize remote logging first
initRemoteLogger();

// Handle visual viewport changes (soft keyboard)
const updateViewportHeight = () => {
  const vh = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
};

updateViewportHeight();
window.visualViewport?.addEventListener('resize', updateViewportHeight);
window.addEventListener('resize', updateViewportHeight);

createRoot(document.getElementById('root')!).render(
  <App />
);
