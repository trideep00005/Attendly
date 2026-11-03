# Attendly Platform Controls Update

## Included features

1. **Maintenance mode** — a Super Admin can switch student access off, choose a reason category (scheduled maintenance, new update, problem fix, other), and write a student-facing notice. The Cloudflare Worker returns HTTP 503 for student/unauthenticated operational API requests while maintenance is active. The read-only `/api/status` endpoint remains public so the frontend can display the notice. Administrator authentication remains available, and authenticated ADMIN, SUPPORT_ADMIN, and SUPER_ADMIN accounts retain API access. The frontend shows a maintenance page/notice to students and polls status every 15 seconds.
2. **Registration pause** — a Super Admin can pause new registrations and write a notice. Both starting email OTP registration and verifying an already-sent registration OTP are blocked while paused. Existing student sign-in and existing accounts remain available when maintenance mode is off.
3. Both controls persist in the existing D1 `app_settings` table and are written to the existing audit log.
4. Global switches are restricted to SUPER_ADMIN.
5. The previously prepared subject/timetable collision fix is retained in the included frontend and Worker files. The related backend subject service/repository changes are also included.

## Database migration

No new migration is required. `app_settings` already exists in `cloudflare/migrations/0001_core_and_saas_schema.sql`.

## Files to overlay

Copy the folders in this archive into the root of your existing Attendly project and allow these 10 files to replace their matching files:

- `cloudflare/src/index.ts`
- `cloudflare/src/lib/platform-controls.ts` (new)
- `cloudflare/src/modules/academic.ts`
- `cloudflare/src/modules/admin.ts`
- `cloudflare/src/modules/auth.ts`
- `attendance-management-v1/frontend/src/App.tsx`
- `attendance-management-v1/frontend/src/pages/SaasPages.tsx`
- `attendance-management-v1/frontend/src/styles.css`
- `attendance-management-v1/backend/src/repositories/subject.repository.ts`
- `attendance-management-v1/backend/src/services/subject.service.ts`

This update archive deliberately does not contain `wrangler.toml`, secrets, `.dev.vars`, `.env`, `node_modules`, build output, or database data.

## Apply and deploy

1. Back up your existing project folder.
2. Overlay the files, preserving the relative folder structure.
3. Run `APPLY_UPDATE.bat` from your project root. Continue only if all Worker, frontend, and backend checks/builds complete successfully.
4. No database migration is needed; do not run `MIGRATE_DATABASE.bat` for this feature.
5. After the build succeeds, run `DEPLOY.bat` to publish the Cloudflare Worker and frontend.
6. Test with a Super Admin account before announcing the feature.

## Important configuration note

If the Cloudflare deployment environment variable `REGISTRATION_ENABLED` is explicitly set to `false`, the environment-level block remains authoritative and the dashboard cannot reopen registration. Change that Cloudflare variable to `true` (or remove the hard-disable) before using the dashboard toggle to reopen registrations.

## Suggested acceptance tests

- With maintenance off, a student can sign in and use normal API features.
- Turn maintenance on in Administration > Platform controls, add a reason, and save. Student tabs should show the reason within about 15 seconds; student API operations should return 503. An administrator should still be able to sign in and use the admin panel.
- Turn maintenance off and save. Student access should resume.
- Pause registration with a message. A visitor should see the message and have no registration option. Existing students should still sign in and use the app.
- Try registration OTP verification after pausing registration: it must be rejected, even if the OTP was requested before the pause.
- Reopen registration and verify that new registration is available again.

## Verification performed for this package

- Cloudflare Worker TypeScript check (`npm run check`) passed.
- The updated `App.tsx` and `SaasPages.tsx` passed TypeScript TSX syntax transpilation.
- A full frontend production build could not be completed in the packaging environment because `npm ci` timed out and left dependencies incomplete. The project-local `APPLY_UPDATE.bat` must complete its full build before deployment.
- Live Cloudflare/D1 integration and browser acceptance tests have not been run from this environment.
