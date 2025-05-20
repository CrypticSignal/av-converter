import { createBrowserRouter } from 'react-router-dom';
import RootLayout from './routes/RootLayout';
import Homepage from './pages/Homepage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <Homepage />,
      },
    ],
  },
]);

export default router;