import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { runShaderSelfTest } from './lib/selfTest.ts';
import './index.css';

// Dev aid: `?selftest` compiles every effect shader and logs PASS/FAIL to the
// console — used by the playwright verification flow.
if (new URLSearchParams(window.location.search).has('selftest')) {
  runShaderSelfTest();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
