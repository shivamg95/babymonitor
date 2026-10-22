import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// Apply the saved theme before first paint, so night mode never flashes bright.
if (localStorage.getItem('bm:night') === '1') {
  document.documentElement.classList.add('night');
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
