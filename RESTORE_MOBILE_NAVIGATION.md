# Attendly Mobile Navigation Recovery + Platform Controls Update

This overlay restores the mobile five-item bottom navigation from the supplied Attendly v0.6.0 redesign while keeping the newer Platform Controls implementation and the subject/timetable business-logic fix.

## Restored mobile navigation
- Home (Dashboard)
- Calendar
- Subjects
- Insights (Analytics)
- More (opens the existing sidebar with the remaining sections)

The app component is based on the Platform Controls update, not the older v0.6.0 App.tsx. It therefore retains maintenance mode, registration pause, Free Semester Access and the subject/timetable fixes. The missing `UserPlus` icon import from the earlier package is also included.

## Overlay instructions
1. Back up the current Attendly project folder.
2. Extract this ZIP directly into the existing Attendly project root. The ZIP paths begin with `attendance-management-v1/` and `cloudflare/`.
3. Allow the 10 listed source files to replace their matching files. Do not extract into an extra nested folder.
4. Do not replace `cloudflare/wrangler.toml`, `.dev.vars`, `.env`, secrets, local database files, or `node_modules`; none are included.
5. Run `APPLY_UPDATE.bat`. Continue only if all checks and builds pass.
6. No database migration is required for restoring this navigation. Do not run `MIGRATE_DATABASE.bat` for this update.
7. Only after a successful build, run `DEPLOY.bat`.

## Included source files (10)
- cloudflare/src/index.ts
- cloudflare/src/lib/platform-controls.ts
- cloudflare/src/modules/academic.ts
- cloudflare/src/modules/admin.ts
- cloudflare/src/modules/auth.ts
- attendance-management-v1/frontend/src/App.tsx
- attendance-management-v1/frontend/src/pages/SaasPages.tsx
- attendance-management-v1/frontend/src/styles.css
- attendance-management-v1/backend/src/repositories/subject.repository.ts
- attendance-management-v1/backend/src/services/subject.service.ts

## Verification status
- Restored JSX contains exactly one `mobile-bottom-nav` element.
- Five expected navigation entries are present.
- Required Lucide icon imports (`LayoutDashboard`, `CalendarDays`, `BookOpen`, `TrendingUp`, `Menu`, and `UserPlus`) are present.
- Matching responsive CSS selectors and safe-area padding are present.
- A full `npm run build` could not be run in this packaging environment because the available `node_modules` copy is incomplete. Run the project's APPLY_UPDATE.bat locally and do not deploy if any build check fails.
- No schema or D1 migration changes are included.
