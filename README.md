# Duck Force — RbA Field Calendar

A PWA for Renewal by Andersen NWO field managers to track installs, services, and job site visits. Replaces the dual-calendar setup with a single source of truth backed by Supabase.

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Database / Auth**: Supabase (PostgreSQL, Row Level Security, Auth)
- **UI**: React 19, Tailwind CSS 4, Lucide icons
- **Hosting**: Vercel

## Getting Started

### Prerequisites

- Node.js 20+
- A Supabase project with the required tables (see below)
- Vercel account (for production deployment)

### Environment Variables

Create a `.env.local` file:

```env
# Supabase — required
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Supabase service role — required for account deletion and admin operations
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Upload API key — required for Power Automate / external upload integrations
UPLOAD_API_KEY=a-secret-key-you-generate

# GitHub — optional, used for /api/orders fallback
GITHUB_TOKEN=ghp_...

# Dev only — path to a local XLS file for /api/dev-load
DEV_XLS_PATH=C:/path/to/test.xls
```

### Install and Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Roles

| Role | Access |
|------|--------|
| **admin** | Full access: calendar, search, uploads, team management, action config, dev panel |
| **payroll-admin** | Calendar, search, time-off management |
| **member** | Calendar, search, settings |

Roles are stored in the `allowed_emails` table in Supabase. Only users whose email appears in this table can sign up or sign in.

## API Routes

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/upload` | POST | Admin (browser) or API key (external) | Upload work orders / account names |
| `/api/orders` | GET | Any authenticated user | Fetch order data |
| `/api/auth/delete-account` | DELETE | Any authenticated user | Delete own account |
| `/api/dev-load` | GET | Dev environment only | Load test data from local file |

## Supabase Requirements

### Tables

- `work_orders` — main data table (work orders and accounts)
- `allowed_emails` — email allowlist with `role` column (`admin`, `payroll-admin`, `member`)
- `access_requests` — pending access requests from unapproved users
- `action_settings` — configurable action types and people
- `time_off_requests` — time-off tracking
- `employees` — employee directory for time-off autocomplete
- `jobs` — material ordering data (from companion app)

### Auth Configuration

- Email/password authentication enabled
- Password recovery emails enabled
- **Site URL**: Must match your production domain
- **Redirect URLs**: Add your production domain and `http://localhost:3000` for dev

## Deployment

Deployed via Vercel. Ensure all environment variables are configured in the Vercel project settings.

### Production Checklist

- [ ] All env vars set in Vercel dashboard
- [ ] Supabase Site URL matches production domain
- [ ] Supabase redirect URLs include production domain
- [ ] `UPLOAD_API_KEY` set and shared with Power Automate flow
- [ ] At least one admin email in `allowed_emails` table

### Rollback

Vercel maintains deployment history. To roll back:
1. Go to the Vercel dashboard → Deployments
2. Find the last known-good deployment
3. Click "..." → "Promote to Production"

## Known Dependency Advisories

The remaining `npm audit` advisories (next, postcss, sharp) all resolve by upgrading to Next.js ≥16.3.0. These are upstream issues:
- **next**: SSRF, DoS, and cache confusion CVEs — mitigated in this app because we don't use custom servers, rewrites, or the Image Optimization API with user-supplied SVGs.
- **postcss**: XSS in CSS stringify output — mitigated because we don't render user-supplied CSS.
- **sharp**: libvips CVEs — mitigated because sharp is only used internally by Next.js image optimization.

Upgrade path: `npm install next@latest` (test thoroughly — major API changes possible).

## Scripts

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```
