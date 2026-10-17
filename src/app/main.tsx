import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  createBrowserRouter,
  createRoutesFromElements,
  Route,
  RouterProvider,
} from 'react-router-dom';
import { Shop } from '@/features/catalog/Shop';
import { Orders } from '@/features/orders/Orders';
import { Checkout } from '@/features/checkout/Checkout';
import { Tracking } from '@/features/orders/Tracking';
import { StorePicker } from '@/features/locations/StorePicker';
import { CustomerScope } from '@/app/CustomerScope';
import { PickupStoresProvider } from '@/features/locations/PickupStoresProvider';
import { StaffAuth } from '@/features/auth/StaffAuth';
import { StaffGate, OwnerGate } from '@/features/auth/guards';
import { StaffHome, StaffStorePicker, StoreWorkspace } from '@/app/StaffWorkspace';
import { PasswordForm } from '@/features/auth/PasswordForm';
import { Owner } from '@/features/owner/Owner';
import { Privacy } from '@/features/privacy/Privacy';
import { OwnerPrivacy } from '@/features/privacy/OwnerPrivacy';
import { OwnerLayout } from '@/features/owner/OwnerLayout';
import { AppErrorBoundary, RecoveryScreen, RouteErrorBoundary } from '@/app/ErrorBoundary';
import '@/app/styles/global.css';
import '@/app/styles/brandPreview.css';

if (new URLSearchParams(window.location.search).get('brand_preview') === 'olive') {
  document.documentElement.dataset.brandPreview = 'olive';
  const banner = document.createElement('div');
  banner.className = 'brand-preview-banner';
  banner.textContent =
    'Образец оформления для согласования · Lobster — приближение, название точки не изменено';
  document.body.prepend(banner);
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route errorElement={<RouteErrorBoundary />}>
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/consent" element={<Privacy consent />} />
      <Route path="/telegram-consent" element={<Privacy telegram />} />
      <Route element={<PickupStoresProvider />}>
        <Route path="/" element={<StorePicker />} />
        <Route path="/locations" element={<StorePicker alwaysChoose />} />
        <Route path="/s/:slug" element={<CustomerScope />}>
          <Route index element={<Shop />} />
          <Route path="checkout" element={<Checkout />} />
        </Route>
        <Route element={<CustomerScope neutral />}>
          <Route path="/orders" element={<Orders />} />
          <Route path="/track" element={<Tracking />} />
        </Route>
        <Route element={<CustomerScope />}>
          <Route path="/checkout" element={<Checkout />} />
        </Route>
      </Route>
      <Route element={<StaffAuth />}>
        <Route element={<StaffGate />}>
          <Route path="/kitchen" element={<StaffHome />} />
          <Route path="/staff/choose" element={<StaffStorePicker />} />
          <Route path="/staff/account" element={<PasswordForm />} />
          <Route path="/staff/stores/:storeId" element={<StoreWorkspace />} />
          <Route path="/staff/stores/:storeId/reports" element={<StoreWorkspace reports />} />
          <Route element={<OwnerGate />}>
            <Route element={<OwnerLayout />}>
              <Route path="/owner" element={<Owner />} />
              <Route path="/owner/stores" element={<Owner section="stores" />} />
              <Route path="/owner/staff" element={<Owner section="staff" />} />
              <Route path="/owner/analytics" element={<Owner section="analytics" />} />
              <Route path="/owner/privacy" element={<OwnerPrivacy />} />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<RecoveryScreen status={404} />} />
    </Route>,
  ),
);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <RouterProvider router={router} />
    </AppErrorBoundary>
  </React.StrictMode>,
);
