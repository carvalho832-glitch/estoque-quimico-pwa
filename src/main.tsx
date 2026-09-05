import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App';
import AdminCloudStockRepair from './components/AdminCloudStockRepair';
import AdminResetStock from './components/AdminResetStock';
import AdminStockImport from './components/AdminStockImport';
import CloudSession from './components/CloudSession';
import InventoryFeature from './components/InventoryFeature';
import Dashboard from './Dashboard';
import './styles.css';
import './dashboard-usage.css';
import './attention-alert.css';
import './product-card-modal.css';
import './cloud-session-floating.css';
import './attention-alert';
import './shelves-browser';
import './in-use-alert';
import './pdf-responsibles';
import './edit-product-modal-fix';
import './location-weather';
import './inventory-divergences';
import './shared-code-batch-registration';
import './inventory-review-improvements';
import './inventory-product-inline-hotfix';
import './cloud-session-floating';

const params = new URLSearchParams(window.location.search);
const isDashboard = params.get('view') === 'dashboard';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CloudSession>
      {isDashboard ? (
        <Dashboard />
      ) : (
        <>
          <App />
          <InventoryFeature />
          <AdminCloudStockRepair />
          <AdminStockImport />
          <AdminResetStock />
        </>
      )}
    </CloudSession>
  </React.StrictMode>,
);

if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator && import.meta.env.PROD) {
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
