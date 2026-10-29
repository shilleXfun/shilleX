import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './App';
import { reloadForUpdate } from './lib/stale';

// A file of an older version failed to load (an update went live while this tab was open): reload once (lib/stale.ts).
window.addEventListener('vite:preloadError', (e) => { if (reloadForUpdate()) e.preventDefault(); });

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
