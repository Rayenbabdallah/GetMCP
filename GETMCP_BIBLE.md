# 📖 GetMCP: The $1B Vision Bible

*“Shopify made businesses internet-ready. GetMCP makes businesses AI-agent ready.”*

---

## 1. The Core Insight

**The Single-MCP Fallacy**
Currently, the industry assumes a 1:1 relationship: "One app gets one Model Context Protocol (MCP) server." This is fundamentally flawed for enterprise reality. Enterprises don't have monolithic trust; they operate on intricate, multi-layered trust boundaries.

**The Reality of Enterprise AI**
A modern enterprise (e.g., Stripe, Salesforce, GitHub) cannot and will not expose its full internal API surface to third-party AI agents. At the same time, internal engineering and ops teams need deep, unconstrained access to automate workflows.

**The GetMCP Revelation: The Two-MCP Model**
GetMCP recognized that enterprises actually need *multiple trust layers* dynamically generated from their existing infrastructure.

1.  **The Internal MCP (The God Mode)**
    *   **Audience:** Internal engineers, automated ops agents, support copilots.
    *   **Scope:** Deep infrastructure access, raw database queries, sensitive log access, untethered execution.
    *   **Examples:** “Investigate failed payments for user X,” “Roll back deployment Y,” “Generate latency anomaly report.”
2.  **The External MCP (The Walled Garden)**
    *   **Audience:** Customers, third-party SaaS integrations, public agent ecosystems.
    *   **Scope:** Highly restricted, strictly policy-driven, scoped to specific tenant data, rate-limited, requiring human-in-the-loop approvals for state changes.
    *   **Examples:** “Refund transaction Z,” “Query my monthly usage,” “Create a new API key.”

---

## 2. The Platform Vision: The AWS for AI Agents

GetMCP is not a dev tool. It is **AI Infrastructure Generation**.

Enterprises want a button that says: *“Make my company AI-ready.”* GetMCP is that button. We generate the secure AI access layer between enterprise software and the global agent economy.

### The "Magic" Workflow
1.  **Ingest:** Connect OpenAPI specs, GraphQL schemas, database schemas, and existing Auth providers (Okta, Auth0).
2.  **Analyze & Segment:** GetMCP's intelligence engine automatically categorizes endpoints into risk tiers (Internal vs. External) based on data sensitivity and mutation impact.
3.  **Policy Generation:** Automatically drafts semantic policies (e.g., "Agents cannot mutate production databases without a Slack approval from an Engineering Manager").
4.  **Instant Infrastructure:** Click "Generate." GetMCP instantly provisions:
    *   The Internal MCP Server.
    *   The External MCP Server.
    *   The Edge Gateway (routing, rate limiting, token validation).
    *   The Observability/Audit Plane.
5.  **Deployment:** Deploy instantly to GetMCP Cloud or export Docker/K8s configs for on-premise deployment.

---

## 3. The Architecture of Trust

GetMCP is essentially an automated Trust Architecture.

### Core Components of the $1B Platform

*   **The Ingestion Engine:** Parses APIs (REST, GraphQL, gRPC), DBs (Postgres, Snowflake), and SaaS tools.
*   **The Policy Control Plane:** A centralized dashboard where security teams define *Agent Access Policies* (AAP) in plain English and code (Rego/OPA).
*   **The Dual-MCP Generator:** Compiles the parsed infrastructure and policies into highly optimized, secure MCP servers (written in Go/Rust for massive concurrency).
*   **The Agent Gateway:** The runtime proxy that intercepts all agent requests, validates them against the Policy Control Plane, executes the action, and logs the result.
*   **The Audit Ledger:** A tamper-proof log of exactly *which* agent took *what* action, *why* they took it (context/reasoning), and *who* approved it.

---

## 4. Why This is a Venture-Scale ($1B+) Opportunity

### The TAM (Total Addressable Market)
Every single B2B and B2C enterprise that exposes an API today will need an MCP tomorrow. If they don't have an MCP, they will be cut out of the agentic web. GetMCP's TAM is the entire API management and API security market, reborn for the AI era.

### The Moat (Defensibility)
*   **Initial Moat:** Time-to-value. What takes an enterprise 6 months of meetings with security, dev, and product to build, GetMCP does in 6 minutes.
*   **Deep Moat:** The Policy Engine & Audit Trail. Once an enterprise integrates their Okta, their Slack approvals, and their internal compliance rules into GetMCP, the switching costs are immense. We become the source of truth for *what AI is allowed to do*.

### The Pricing Model (Land and Expand)
*   **Developer/Startup (Free/Self-Serve):** Generate basic Internal/External MCPs from an OpenAPI spec.
*   **Growth ($999/mo):** Add custom policies, Slack approvals, and 30-day audit logs.
*   **Enterprise ($10k+/mo):** On-prem deployment, custom SSO, unlimited agents, SIEM integration (Splunk/Datadog), and dedicated SLAs.

---

## 5. The Long-Term Vision: The Global AI Control Plane

Today, GetMCP generates MCP servers for individual companies.

Tomorrow, GetMCP becomes the **global standard for Agent Permissions and Execution Policies**.

When an Anthropic agent talks to a Stripe agent, they will negotiate trust, permissions, and payment through the GetMCP layer.

We are building the **Identity and Access Management (IAM) for non-human workers.**

*   **Phase 1 (The Wedge):** Automated MCP Generation (The MVP).
*   **Phase 2 (The Platform):** Enterprise Policy & Audit Control Plane.
*   **Phase 3 (The Ecosystem):** The Global Registry and Trust Network for AI Agents.

---

## 6. The Pitch (Elevator Version)

"Enterprises are terrified of letting AI agents access their systems, but they know they have to. GetMCP is an automated infrastructure platform that takes any company's existing APIs and instantly generates secure, policy-driven AI access layers. We separate internal 'god-mode' access from external 'customer-safe' access automatically. We aren't building AI agents; we're building the secure infrastructure that allows AI agents to actually do work in the real world."

---

## 7. The Sharpened Pitch — Zero Trust for AI Agents

"Companies spent the last decade building Zero Trust for their employees — verify every request, least privilege, audit everything. AI agents broke that model overnight: most companies hand agents a single API key and pray. GetMCP is Zero Trust Architecture for AI agents. We generate both the **internal MCP servers** (so your own teams' agents can safely operate god-mode against production) and the **customer-facing external MCP servers** (so your customers' agents can transact with you), then enforce per-request identity, scoped permissions, policy-driven access, and a tamper-evident audit ledger across both — the exact controls security teams already require for humans, finally extended to non-human workers."

### One-liner (deck / tweet)

**"Zero Trust for AI agents — internal and external. We generate the MCP servers and run the policy + audit layer that makes them safe to ship."**

### Why this framing changes the business

- **Different buyer.** "AI infrastructure" sells to platform engineers ($10–50k/year). "Zero Trust for AI" sells to CISOs and Heads of Security ($100k–1M+/year). Same product, 10× the check.
- **Different competitors.** Without this framing we compete with Arcade, Composio, Smithery — every MCP gateway startup in a race to the bottom. With it, we compete with Okta, Cloudflare, Zscaler for the *agent* segment, which none of them serve yet.
- **Existing vocabulary.** Security teams don't have to invent a new line item; "agent Zero Trust" goes on the same compliance docs, SOC2 controls, and RFPs as their human Zero Trust stack.
- **Land-and-expand baked in.** Customers start with internal MCP (low risk, fast win), graduate to external MCP (high revenue, high lock-in) on the same platform, same audit log, same policies. One control plane for every non-human worker — the consolidation pitch security buyers love.

### Zero Trust principles → what GetMCP actually ships

| Zero Trust principle | GetMCP implementation |
|---|---|
| Verify explicitly — authenticate every request | Per-org bearer key + `x-agent-id` resolved per call |
| Least privilege access | Two-MCP split: external agents get a scoped subset, not god mode |
| Assume breach — every action observable | Hash-chained, tamper-evident audit ledger |
| Continuous validation | Policy engine evaluates every request: rate limits, approvals, allowlists |
| Microsegmentation | Per-org isolation, per-tenant rate buckets, per-agent scopes |
