import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from "react";
import { getApiKey } from './lib/auth';
import { Layout } from './components/Layout';
import { Auth } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { Policies } from './pages/Policies';
import { Agents } from './pages/Agents';
import { Audit } from './pages/Audit';
import { Approvals } from './pages/Approvals';
import { Generator } from './pages/Generator';
import { ApiKeys } from './pages/ApiKeys';
import { Organization } from './pages/Organization';

function RequireAuth({ children }: { children: ReactNode }) {
  if (!getApiKey()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Auth />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="generator" element={<Generator />} />
          <Route path="policies" element={<Policies />} />
          <Route path="agents" element={<Agents />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path="audit" element={<Audit />} />
          <Route path="api-keys" element={<ApiKeys />} />
          <Route path="organization" element={<Organization />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
