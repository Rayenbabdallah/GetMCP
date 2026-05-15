import { Link, NavLink, Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';
import { getApiKey } from '../lib/auth';

export function MarketingLayout() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <Header />
      <Outlet />
      <Footer />
    </div>
  );
}

function Header() {
  const authed = Boolean(getApiKey());
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white">G</div>
          <span className="text-sm font-semibold tracking-tight">GetMCP</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <NavItem to="/docs">Docs</NavItem>
          <a
            href="https://github.com/Rayenbabdallah/GetMCP"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            GitHub
          </a>
          <span className="mx-2 h-5 w-px bg-slate-200" />
          {authed ? (
            <Link
              to="/app"
              className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700"
            >
              Open dashboard
            </Link>
          ) : (
            <>
              <Link to="/login" className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                Sign in
              </Link>
              <Link
                to="/login"
                className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700"
              >
                Get started
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function NavItem({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded-md px-3 py-1.5 transition-colors ${
          isActive
            ? 'text-brand-700 bg-brand-50'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-6 py-12 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white">G</div>
            <span className="text-sm font-semibold tracking-tight">GetMCP</span>
          </Link>
          <p className="mt-3 max-w-md text-sm text-slate-600">
            Zero Trust for AI agents. Generate the MCP servers your customers' agents need, then enforce who can do what.
          </p>
        </div>
        <FooterCol title="Product" links={[
          { label: 'Documentation', to: '/docs' },
          { label: 'Quickstart', to: '/docs/quickstart' },
          { label: 'API reference', to: '/docs/api' },
          { label: 'Sign in', to: '/login' },
        ]} />
        <FooterCol title="Company" links={[
          { label: 'GitHub', to: 'https://github.com/Rayenbabdallah/GetMCP', external: true },
          { label: 'Security', to: 'https://github.com/Rayenbabdallah/GetMCP/blob/main/SECURITY.md', external: true },
          { label: 'Vision', to: 'https://github.com/Rayenbabdallah/GetMCP/blob/main/GETMCP_BIBLE.md', external: true },
        ]} />
      </div>
      <div className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4 text-xs text-slate-500">
          © {new Date().getFullYear()} GetMCP. Open source.
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: Array<{ label: string; to: string; external?: boolean }> }) {
  return (
    <div>
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h4>
      <ul className="space-y-2 text-sm">
        {links.map((l) =>
          l.external ? (
            <li key={l.label}>
              <a href={l.to} target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:text-brand-700">
                {l.label}
              </a>
            </li>
          ) : (
            <li key={l.label}>
              <Link to={l.to} className="text-slate-600 hover:text-brand-700">{l.label}</Link>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
