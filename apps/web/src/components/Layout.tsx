import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { clearApiKey, getOrgName } from '../lib/auth';
import { api } from '../lib/api';
import { Logo } from './ui/Logo';

interface NavItem {
  label: string;
  to: string;
  icon: ReactNode;
}

const NAV: NavItem[] = [
  { label: 'Dashboard',     to: '/app',              icon: <IconDashboard /> },
  { label: 'Generator',     to: '/app/generator',    icon: <IconGenerator /> },
  { label: 'Policies',      to: '/app/policies',     icon: <IconShield /> },
  { label: 'Agents',        to: '/app/agents',       icon: <IconBot /> },
  { label: 'Approvals',     to: '/app/approvals',    icon: <IconApprove /> },
  { label: 'Audit log',     to: '/app/audit',        icon: <IconLedger /> },
  { label: 'API keys',      to: '/app/api-keys',     icon: <IconKey /> },
  { label: 'Organization',  to: '/app/organization', icon: <IconBuilding /> },
];

export function Layout() {
  const navigate = useNavigate();
  const [orgName, setName] = useState<string | null>(getOrgName());
  const [chainOk, setChainOk] = useState<boolean | null>(null);

  useEffect(() => {
    // Refresh org name + chain status in the background; not critical.
    api('/orgs/me').then((o) => o?.name && setName(o.name)).catch(() => undefined);
    api('/audit/verify').then((v) => setChainOk(Boolean(v?.valid))).catch(() => setChainOk(null));
  }, []);

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex h-14 items-center gap-2.5 border-b border-slate-200 px-4">
          <Logo size={28} />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-slate-900">GetMCP</span>
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Zero Trust for AI</span>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/app'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              <span className="text-slate-400 group-hover:text-slate-600">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <div className="mb-2 flex items-center gap-2 px-2 text-xs">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                chainOk === null ? 'bg-slate-300' : chainOk ? 'bg-emerald-500' : 'bg-red-500'
              }`}
              title={
                chainOk === null
                  ? 'Audit chain status unknown'
                  : chainOk
                    ? 'Audit chain valid'
                    : 'Audit chain BROKEN'
              }
            />
            <span className="font-medium text-slate-700">{orgName ?? 'Organization'}</span>
          </div>
          <button
            onClick={() => {
              clearApiKey();
              navigate('/login');
            }}
            className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/* --- icons --- */
const ic = 'h-4 w-4 stroke-current';

function IconDashboard() { return (<svg className={ic} viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>); }
function IconGenerator() { return (<svg className={ic} viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22" x2="12" y2="12"/></svg>); }
function IconShield() { return (<svg className={ic} viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>); }
function IconBot() { return (<svg className={ic} viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 2v6"/><circle cx="12" cy="3" r="1"/><path d="M8 14h.01"/><path d="M16 14h.01"/></svg>); }
function IconApprove() { return (<svg className={ic} viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>); }
function IconLedger() { return (<svg className={ic} viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>); }
function IconKey() { return (<svg className={ic} viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M11 12l9-9"/><path d="M16 7l3 3"/></svg>); }
function IconBuilding() { return (<svg className={ic} viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01"/></svg>); }
