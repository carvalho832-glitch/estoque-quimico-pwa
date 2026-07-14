import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import CloudSession from './components/CloudSession';
import Dashboard from './Dashboard';
import './styles.css';

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
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.error('Falha ao registrar o service worker:', error);
    });
  });
}
