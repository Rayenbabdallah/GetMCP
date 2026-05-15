import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { getApiKey } from './lib/auth';
import { Layout } from './components/Layout';
import { MarketingLayout } from './components/MarketingLayout';
import { Auth } from './pages/Auth';
import { Landing } from './pages/Landing';
import { Docs } from './pages/Docs';
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
        {/* Public marketing site */}
        <Route element={<MarketingLayout />}>
          <Route index element={<Landing />} />
          <Route path="docs/*" element={<Docs />} />
        </Route>

        {/* Auth screen — bare layout */}
        <Route path="/login" element={<Auth />} />

        {/* Protected dashboard */}
        <Route
          path="/app"
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
