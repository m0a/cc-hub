import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initRemoteLogger } from './utils/remoteLogger';
import './i18n';
import './index.css';

// Initialize remote logging first
initRemoteLogger();

// Log app version and device info for debugging
console.log(`[CC Hub] App loaded - ${new Date().toISOString()}`);
console.log(`[CC Hub] UA: ${navigator.userAgent}`);
console.log(`[CC Hub] Screen: ${screen.width}x${screen.height} DPR:${devicePixelRatio}`);
console.log(`[CC Hub] Viewport: ${window.innerWidth}x${window.innerHeight}`);
console.log(`[CC Hub] WebGL: ${(() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })()}`);
console.log(`[CC Hub] SW: ${('serviceWorker' in navigator) ? 'supported' : 'unsupported'}`);

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
