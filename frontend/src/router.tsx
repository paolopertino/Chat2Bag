import { createBrowserRouter, Navigate } from "react-router-dom";

import { FullBleedLayout } from "./components/layout/full-bleed-layout";
import { ProtectedRoute } from "./components/layout/protected-route";
import { LoginPage } from "./pages/login";
import { MapHomePage } from "./pages/map-home";
import { BagViewerPage } from "./pages/bag-viewer";

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <FullBleedLayout />,
        children: [
          { index: true, element: <MapHomePage /> },
          { path: "bags/:bagId", element: <BagViewerPage /> },
          { path: "*", element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);
