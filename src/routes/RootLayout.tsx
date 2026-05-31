import React from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { Container } from '@mui/material';

const RootLayout: React.FC = () => {
  return (
    <div className="app-shell">
      <Navbar />
      <main>
        <Container maxWidth={false} disableGutters>
          <div className="content-wrap fade-up">
            <Outlet />
          </div>
        </Container>
      </main>
    </div>
  );
};

export default RootLayout;
