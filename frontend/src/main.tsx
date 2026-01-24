import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initRemoteLogger } from './utils/remoteLogger';
import './index.css';

// Initialize remote logging first
initRemoteLogger();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
