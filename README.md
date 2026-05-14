# GetMCP Beta Deployment Guide

Welcome to the GetMCP Beta. This guide outlines how to deploy the GetMCP Enterprise Control Plane to your infrastructure.

## Prerequisites
- Docker & Docker Compose
- Node.js 20+ (for local development)
- PostgreSQL (if running outside of Docker)

## Quick Start (Docker Compose)

The easiest way to run the GetMCP platform is via the included Docker Compose configuration. This will spin up a secure PostgreSQL database, the NestJS Policy Engine (API), and the React Control Plane Dashboard.

1. **Set Environment Variables**
   Ensure the `apps/api/.env` file exists with your secure database credentials:
   ```env
   DATABASE_URL="postgresql://getmcp:beta_password_secure@postgres:5432/getmcp_platform?schema=public"
   ```

2. **Initialize the Database**
   Before starting the API, you need to push the Prisma schema to the database.
   ```bash
   # Start the DB in the background
   docker-compose up -d postgres
   
   # Wait a few seconds, then push the schema
   cd apps/api
   npx prisma db push
   ```

3. **Start the Platform**
   Return to the root directory and start all services:
   ```bash
   docker-compose up --build -d
   ```

4. **Access the Dashboard**
   Navigate to `http://localhost:80` (or your server's IP) to access the GetMCP Control Plane.

## Architecture Overview

- **`apps/api` (NestJS):** The core intelligence engine. It parses OpenAPI specs, generates Two-MCP trust boundaries, and runs the Proxy Interceptor to evaluate real-time agent requests against your policies.
- **`apps/web` (React/Vite):** The enterprise dashboard for managing policies, generating infrastructure, and viewing audit logs.
- **`docker-compose.yml`**: Production-ready container orchestration.

## Managing Policies (Beta)
In this Beta release, policies are hardcoded in the `ProxyService` for demonstration. In the upcoming RC1 release, the UI will sync directly with the `PolicyRule` PostgreSQL table defined in our Prisma schema.
