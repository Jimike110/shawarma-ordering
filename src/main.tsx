import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Shop } from './pages/Shop';
import { Orders } from './pages/Orders';
import { Checkout } from './pages/Checkout';
import { Tracking } from './pages/Tracking';
import { StorePicker, CustomerScope } from './pages/Stores';
import { PickupStoresProvider } from './pickupStores';
import {
  StaffAuth,
  StaffGate,
  StaffHome,
  StaffStorePicker,
  StoreWorkspace,
  OwnerGate,
  PasswordForm,
} from './staff';
import { Owner } from './pages/Owner';
import './styles.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<PickupStoresProvider />}>
          <Route path="/" element={<StorePicker />} />
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
              <Route path="/owner" element={<Owner />} />
            </Route>
          </Route>
        </Route>
        <Route
          path="*"
          element={
            <main className="container empty">
              <h1>Страница не найдена</h1>
              <a href="/">Вернуться в меню</a>
            </main>
          }
        />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
