import { useState } from 'react';

export function CodeBlock({ children, copy }: { children: string; copy?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs leading-relaxed text-slate-800">
        {children}
      </pre>
      {copy && (
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(children);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="absolute right-2 top-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 opacity-0 transition-opacity hover:bg-slate-50 group-hover:opacity-100"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  );
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.8125rem] text-slate-800">
      {children}
    </code>
  );
}
