import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import Layout from "./components/Layout";
import Overview from "./pages/Overview";
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import Negotiator from "./pages/Negotiator";
import Commitments from "./pages/Commitments";
import Ask from "./pages/Ask";
import MemoryExplorer from "./pages/MemoryExplorer";
import Playbook from "./pages/Playbook";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="customers" element={<Customers />} />
          <Route path="customers/:id" element={<CustomerDetail />} />
          <Route path="negotiate" element={<Negotiator />} />
          <Route path="commitments" element={<Commitments />} />
          <Route path="ask" element={<Ask />} />
          <Route path="memory" element={<MemoryExplorer />} />
          <Route path="playbook" element={<Playbook />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
