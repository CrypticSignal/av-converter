import React from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { Container } from '@mui/material';

const RootLayout: React.FC = () => {
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