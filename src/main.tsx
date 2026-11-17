import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerAppServiceWorker } from './services/pushService';

registerAppServiceWorker().catch(() => {
  // Non-blocking Service Worker initialization
});

createRoot(document.getElementById('root')!).render(<App />);
