import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import CloudSession from './components/CloudSession';
import Dashboard from './Dashboard';
import './styles.css';
import './dashboard-usage.css';
import './attention-alert.css';
import './attention-alert';
import './in-use-alert';
import './pdf-responsibles';

const params = new URLSearchParams(window.location.search);
const isDashboard = params.get('view') === 'dashboard';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CloudSession>
      {isDashboard ? <Dashboard /> : <App />}
    </CloudSession>
  </React.StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let refreshing = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch((error) => {
        console.error('Falha ao registrar o service worker:', error);
      });
  });
}
