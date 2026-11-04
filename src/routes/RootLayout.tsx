import React, { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { Container } from '@mui/material';
import { logVisit } from '../utils/logVisit';

const RootLayout: React.FC = () => {
  const { pathname } = useLocation();
  // StrictMode runs effects twice in development; don't log the same page twice.
  const lastLoggedPath = useRef<string | null>(null);

  // Log every page shown, whether the visitor loaded it directly or navigated within the app.
  useEffect(() => {
    if (lastLoggedPath.current === pathname) return;
    lastLoggedPath.current = pathname;
    logVisit(pathname);
  }, [pathname]);

  return (
    <>
      <Navbar />
      <main className="text-center">
        <Container maxWidth={false} disableGutters>
          <Outlet />
        </Container>
      </main>
    </>
  );
};

export default RootLayout;
