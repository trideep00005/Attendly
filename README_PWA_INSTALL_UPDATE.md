# Attendly PWA Installation Update

## What this update adds
- `More` page: a prominent **Install Attendly** item at the top.
- A dedicated `Install Attendly` page.
- Android/Chromium: captures `beforeinstallprompt` at the app root (so it is not missed before the install page opens) and triggers the native browser prompt when the browser makes it available.
- iPhone/iPad: displays Safari Add to Home Screen instructions.
- Detects when Attendly is already running in standalone/installed mode and shows an installed state.
- Adds the web app manifest, 192px/512px icons, a maskable icon, Apple touch icon, and iOS web-app metadata.

## Files included
- `attendance-management-v1/frontend/index.html`
- `attendance-management-v1/frontend/src/App.tsx`
- `attendance-management-v1/frontend/src/pages/InstallAttendlyPage.tsx` (new)
- `attendance-management-v1/frontend/src/styles.css`
- `attendance-management-v1/frontend/public/manifest.webmanifest` (new)
- `attendance-management-v1/frontend/public/icons/*` (new)

## Safety / compatibility
- No API routes, authentication flows, database schemas, D1 migrations, subscription code, attendance calculations, subject/routine code, or Cloudflare configuration are changed by this PWA update.
- No service worker or offline cache is added. A service worker is not required for installability; leaving it out avoids caching authenticated API responses or stale application bundles. Attendly continues to use its normal online Cloudflare APIs.
- Existing More page, Free Semester Access, subscription and platform-control logic are preserved in the supplied `App.tsx` base (latest backup + the previously successful More-page restoration).

## Install behavior
- The custom Android install button works only when the browser dispatches `beforeinstallprompt` (HTTPS, installable manifest, supported browser and browser criteria). Otherwise, the page provides browser-menu instructions.
- On iPhone/iPad, use Safari Share > Add to Home Screen > enable Open as Web App if shown > Add.
- Installing is device-local; each student installs Attendly on their own device and signs in with their existing account.

## Apply
1. Back up the current project.
2. Extract this ZIP into the project root and allow the listed files to replace their matching files.
3. Run `APPLY_UPDATE.bat` and wait for the complete frontend/backend checks to pass.
4. Test on the HTTPS production site: More > Install Attendly, Android Chrome prompt, iPhone Safari instructions, and already-installed state.
5. Only then run `DEPLOY.bat`.

No database migration is required.
