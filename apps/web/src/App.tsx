import { useState } from 'react';
import './index.css';

function App() {
  const [activeTab, setActiveTab] = useState('generator');
  const [specUrl, setSpecUrl] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [internalCount, setInternalCount] = useState(0);
  const [externalCount, setExternalCount] = useState(0);

  const handleGenerate = async () => {
    if (!specUrl) return;
    setIsGenerating(true);
    
    try {
      const response = await fetch('http://localhost:3000/generator/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          openapiUrl: specUrl,
          authProvider: 'Okta',
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Generation failed');
      }
      
      setInternalCount(data.internalEndpointsCount);
      setExternalCount(data.externalEndpointsCount);
      setGenerated(true);
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div>
          <h2 className="primary-gradient-text" style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>GetMCP</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Enterprise AI Control Plane</p>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '2rem' }}>
          <button 
            className={`btn ${activeTab === 'generator' ? 'glass-panel' : 'btn-secondary'}`}
            style={{ justifyContent: 'flex-start', border: activeTab === 'generator' ? '' : 'none' }}
            onClick={() => setActiveTab('generator')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            Infrastructure Generator
          </button>
          <button 
            className={`btn ${activeTab === 'policies' ? 'glass-panel' : 'btn-secondary'}`}
            style={{ justifyContent: 'flex-start', border: activeTab === 'policies' ? '' : 'none' }}
            onClick={() => setActiveTab('policies')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            Policy Engine
          </button>
          <button 
            className={`btn ${activeTab === 'audit' ? 'glass-panel' : 'btn-secondary'}`}
            style={{ justifyContent: 'flex-start', border: activeTab === 'audit' ? '' : 'none' }}
            onClick={() => setActiveTab('audit')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            Audit Ledger
          </button>
        </nav>

        <div style={{ marginTop: 'auto' }}>
          <div className="glass-panel" style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary), var(--secondary))' }}></div>
            <div>
              <p style={{ fontSize: '0.85rem', fontWeight: 500 }}>Admin User</p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Stripe Inc.</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {activeTab === 'generator' && (
          <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <header style={{ marginBottom: '3rem' }} className="animate-fade-in">
              <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Agent Infrastructure</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>
                Automatically generate secure internal and external MCP layers from your APIs.
              </p>
            </header>

          {!generated ? (
            <div className="glass-panel animate-fade-in delay-1" style={{ padding: '3rem' }}>
              <div style={{ maxWidth: '600px', margin: '0 auto' }}>
                <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                  <div style={{ display: 'inline-flex', padding: '1rem', borderRadius: '50%', background: 'rgba(99, 102, 241, 0.1)', color: 'var(--primary)', marginBottom: '1rem' }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>
                  </div>
                  <h2 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>Generate Trust Boundaries</h2>
                  <p style={{ color: 'var(--text-muted)' }}>Provide your OpenAPI specification to auto-generate the Two-MCP architecture.</p>
                </div>

                <div className="input-group">
                  <label htmlFor="openapi-url">OpenAPI Spec URL</label>
                  <input 
                    type="text" 
                    id="openapi-url"
                    className="input-field" 
                    placeholder="https://api.stripe.com/v1/openapi.json"
                    value={specUrl}
                    onChange={(e) => setSpecUrl(e.target.value)}
                  />
                </div>

                <div className="input-group">
                  <label>Authentication Provider</label>
                  <select className="input-field" style={{ appearance: 'none' }}>
                    <option>Okta / Auth0 (Enterprise SSO)</option>
                    <option>Custom JWT</option>
                    <option>API Key</option>
                  </select>
                </div>

                <button 
                  className="btn btn-primary" 
                  style={{ width: '100%', marginTop: '1rem', padding: '1rem', fontSize: '1.1rem' }}
                  onClick={handleGenerate}
                  disabled={!specUrl || isGenerating}
                >
                  {isGenerating ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <svg className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
                      Analyzing API Topology...
                    </span>
                  ) : 'Generate MCP Infrastructure'}
                </button>
                <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
              </div>
            </div>
          ) : (
            <div className="animate-fade-in">
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem', padding: '1rem', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--accent)', borderRadius: '8px', color: 'var(--accent)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                <span style={{ fontWeight: 500 }}>Successfully generated enterprise AI architecture.</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                {/* Internal MCP */}
                <div className="glass-panel" style={{ padding: '2rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
                    <div>
                      <h3 style={{ fontSize: '1.25rem', color: '#ef4444', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
                        Internal MCP
                      </h3>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>God-mode access for internal engineering agents</p>
                    </div>
                    <span style={{ padding: '0.25rem 0.75rem', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600 }}>HIGH PRIVILEGE</span>
                  </div>
                  
                  <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', fontFamily: 'monospace', fontSize: '0.85rem', color: '#94a3b8' }}>
                    wss://internal.getmcp.cloud/v1/ws<br/>
                    <span style={{ color: '#ef4444' }}>Endpoints: {internalCount} (Full Surface)</span>
                  </div>

                  <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '2rem' }}>
                    <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Raw DB Query Execution</li>
                    <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Deployment Rollbacks</li>
                    <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Customer Impersonation Auth</li>
                  </ul>

                  <button className="btn btn-secondary" style={{ width: '100%' }}>View Configuration</button>
                </div>

                {/* External MCP */}
                <div className="glass-panel" style={{ padding: '2rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
                    <div>
                      <h3 style={{ fontSize: '1.25rem', color: '#10b981', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                        External MCP
                      </h3>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Walled garden for third-party AI integrations</p>
                    </div>
                    <span style={{ padding: '0.25rem 0.75rem', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600 }}>SCOPED & SAFE</span>
                  </div>
                  
                  <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', fontFamily: 'monospace', fontSize: '0.85rem', color: '#94a3b8' }}>
                    wss://api.getmcp.cloud/v1/ws<br/>
                    <span style={{ color: '#10b981' }}>Endpoints: {externalCount} (Filtered Surface)</span>
                  </div>

                  <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '2rem' }}>
                    <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Tenant-Id Hard Enforced</li>
                    <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Human-in-Loop for Mutations</li>
                    <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Strict Rate Limiting</li>
                  </ul>

                  <button className="btn btn-primary" style={{ width: '100%' }}>Copy Connection URL</button>
                </div>
              </div>

              <div style={{ marginTop: '3rem', textAlign: 'center' }}>
                <a 
                  href={`http://localhost:3000/generator/export?openapiUrl=${encodeURIComponent(specUrl)}`}
                  download
                  style={{ textDecoration: 'none' }}
                >
                  <button className="btn btn-primary" style={{ padding: '1.25rem 2.5rem', fontSize: '1.1rem', borderRadius: '12px', boxShadow: '0 8px 30px var(--primary-glow)' }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    Download Deployable MCP Infrastructure (.zip)
                  </button>
                </a>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '1rem' }}>Includes Internal Node.js Server, External Node.js Server, and Docker Compose configs.</p>
              </div>
            </div>
          )}
        </div>
        )}

        {activeTab === 'policies' && (
          <div style={{ maxWidth: '1000px', margin: '0 auto' }} className="animate-fade-in">
            <header style={{ marginBottom: '3rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Policy Control Plane</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>
                  Define semantic rules for what AI agents are allowed to do.
                </p>
              </div>
              <button className="btn btn-primary">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                New Policy Rule
              </button>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '2rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* Rule 1 */}
                <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid #ef4444' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>MUTATION</span>
                      <h3 style={{ fontSize: '1.1rem' }}>Require Human Approval for Refunds</h3>
                    </div>
                    <div className="toggle" style={{ width: '40px', height: '20px', background: 'var(--primary)', borderRadius: '10px', position: 'relative' }}>
                      <div style={{ width: '16px', height: '16px', background: 'white', borderRadius: '50%', position: 'absolute', top: '2px', right: '2px' }}></div>
                    </div>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                    Any agent attempting to hit <code>POST /v1/refunds</code> via the External MCP must receive explicit Slack approval from the <code>@finance-ops</code> team before execution.
                  </p>
                  <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.8rem', color: '#8b5cf6' }}>
                    IF method == "POST" AND path == "/v1/refunds" AND source == "external_mcp"<br/>
                    THEN invoke_webhook("slack_approval", {"{"}"channel": "#finance-ops"{"}"})
                  </div>
                </div>

                {/* Rule 2 */}
                <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid #f59e0b' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>RATE LIMIT</span>
                      <h3 style={{ fontSize: '1.1rem' }}>Tenant Isolation Quota</h3>
                    </div>
                    <div className="toggle" style={{ width: '40px', height: '20px', background: 'var(--primary)', borderRadius: '10px', position: 'relative' }}>
                      <div style={{ width: '16px', height: '16px', background: 'white', borderRadius: '50%', position: 'absolute', top: '2px', right: '2px' }}></div>
                    </div>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    Agents acting on behalf of a tenant cannot exceed 50 read queries per minute to prevent DB monopolization.
                  </p>
                </div>

                {/* Rule 3 */}
                <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid #10b981' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>AUDIT</span>
                      <h3 style={{ fontSize: '1.1rem' }}>Mandatory Context Logging</h3>
                    </div>
                    <div className="toggle" style={{ width: '40px', height: '20px', background: 'var(--primary)', borderRadius: '10px', position: 'relative' }}>
                      <div style={{ width: '16px', height: '16px', background: 'white', borderRadius: '50%', position: 'absolute', top: '2px', right: '2px' }}></div>
                    </div>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    All requests must include a valid <code>X-Agent-Reasoning</code> header detailing why the action was taken.
                  </p>
                </div>
              </div>

              {/* Sidebar stats */}
              <div>
                <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                  <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '1rem' }}>Policy Evaluation Engine</h4>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '2.5rem', fontWeight: 700, lineHeight: 1 }}>1.2</span>
                    <span style={{ color: 'var(--text-muted)', paddingBottom: '0.4rem' }}>ms</span>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#10b981' }}>Avg latency overhead</p>
                </div>

                <div className="glass-panel" style={{ padding: '1.5rem' }}>
                  <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '1rem' }}>Intercepted Actions (24h)</h4>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                    <span>Approved</span>
                    <span style={{ color: '#10b981' }}>14,203</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                    <span>Awaiting Human</span>
                    <span style={{ color: '#f59e0b' }}>12</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                    <span>Rejected (Violations)</span>
                    <span style={{ color: '#ef4444' }}>84</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === 'audit' && (
          <div style={{ maxWidth: '1000px', margin: '0 auto', textAlign: 'center', padding: '5rem 0' }} className="animate-fade-in">
            <div style={{ display: 'inline-flex', padding: '2rem', borderRadius: '50%', background: 'rgba(99, 102, 241, 0.05)', color: 'var(--primary)', marginBottom: '1.5rem' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            </div>
            <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Audit Ledger</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', maxWidth: '600px', margin: '0 auto' }}>
              The cryptographic log of every action taken by every agent, along with human approvals and semantic reasoning. 
              <br/><br/>
              <span style={{ color: 'var(--primary)' }}>Coming in Phase 2.</span>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
