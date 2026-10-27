import { createBrowserRouter } from 'react-router-dom';
import RootLayout from './routes/RootLayout';
import Homepage from './pages/Homepage';
import DownloadPage from './pages/DownloadPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { path: 'download', element: <DownloadPage /> },
      {
        index: true,
        element: <Homepage />,
      },
    ],
  },
]);

export default router;
