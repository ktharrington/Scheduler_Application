// /scheduler-frontend/main.jsx
import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Layout from "./Layout.jsx";
import CalendarPage from "./Pages/Calendar.jsx";
import DayPlanner from "./Pages/DayPlanner.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/calendar" replace />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/dayplanner" element={<DayPlanner />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
