import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { AuthProvider, useAuth } from "./auth";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import Negotiator from "./pages/Negotiator";
import Commitments from "./pages/Commitments";
import MemoryExplorer from "./pages/MemoryExplorer";
import Playbook from "./pages/Playbook";

function App() {
  const { user, checking } = useAuth();
  if (checking)
    return (
      <div className="grid h-full place-items-center">
        <Spinner label="Restoring your session…" />
      </div>
    );
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="negotiate" element={<Negotiator />} />
        <Route path="commitments" element={<Commitments />} />
        <Route path="memory" element={<MemoryExplorer />} />
        <Route path="playbook" element={<Playbook />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
