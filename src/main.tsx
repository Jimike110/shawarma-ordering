import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { CartProvider } from './cart';
import { MenuProvider } from './menu';
import { Shop } from './pages/Shop';
import { Checkout } from './pages/Checkout';
import { Tracking } from './pages/Tracking';
import { Kitchen } from './pages/Kitchen';
import { Layout } from './ui';
import './styles.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <CartProvider>
        <MenuProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Shop />} />
              <Route path="/checkout" element={<Checkout />} />
              <Route path="/track" element={<Tracking />} />
              <Route path="/kitchen" element={<Kitchen />} />
              <Route
                path="*"
                element={
                  <main className="container empty">
                    <h1>Страница не найдена</h1>
                    <a href="/">Вернуться в меню</a>
                  </main>
                }
              />
            </Route>
          </Routes>
        </MenuProvider>
      </CartProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
