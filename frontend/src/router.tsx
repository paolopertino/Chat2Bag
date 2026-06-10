import { createBrowserRouter, Navigate } from "react-router-dom";

import { FullBleedLayout } from "./components/layout/full-bleed-layout";
import { MainLayout } from "./components/layout/main-layout";
import { ProtectedRoute } from "./components/layout/protected-route";
import { LoginPage } from "./pages/login";
import { MapHomePage } from "./pages/map-home";
import { BagViewerPage } from "./pages/bag-viewer";
import { BagDetailPage } from "./pages/bags/bag-detail-page";
import { BagsLayout } from "./pages/bags/bags-layout";
import { BagsListPage } from "./pages/bags/bags-list-page";
import { SearchPage } from "./pages/search";
import { WorkspacePage } from "./pages/workspace";

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
        ],
      },
      {
        element: <MainLayout />,
        children: [
          { path: "workspace", element: <WorkspacePage /> },
          { path: "search", element: <SearchPage /> },
          {
            path: "bags",
            element: <BagsLayout />,
            children: [
              { index: true, element: <BagsListPage /> },
              { path: ":bagId/detail", element: <BagDetailPage /> },
            ],
          },
          { path: "*", element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);
