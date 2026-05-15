import type { ReactNode } from "react";

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-slate-200 bg-slate-50/60">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-slate-100">{children}</tbody>;
}

export function TR({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <tr
      onClick={onClick}
      className={onClick ? 'cursor-pointer hover:bg-slate-50/60' : undefined}
    >
      {children}
    </tr>
  );
}

export function TH({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 ${className}`}
    >
      {children}
    </th>
  );
}

export function TD({ children, className = '', mono }: { children?: ReactNode; className?: string; mono?: boolean }) {
  return (
    <td className={`px-6 py-3 align-middle text-slate-700 ${mono ? 'font-mono text-xs text-slate-600' : ''} ${className}`}>
      {children}
    </td>
  );
}
