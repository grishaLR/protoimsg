import '@protoimsg/ui/tokens';
import './app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initSentry } from './sentry';
import { App } from './App';

initSentry();

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
