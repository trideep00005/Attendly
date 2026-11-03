import type { Env } from "../types";

export interface PlatformControls {
  maintenanceEnabled: boolean;
  maintenanceReason: string;
  maintenanceType: string;
  registrationPaused: boolean;
  registrationReason: string;
}

const DEFAULT_CONTROLS: PlatformControls = {
  maintenanceEnabled: false,
  maintenanceReason: "",
  maintenanceType: "MAINTENANCE",
  registrationPaused: false,
  registrationReason: "",
};

/** Reads global platform controls from the existing app_settings table. */
export async function getPlatformControls(env: Pick<Env, "DB">): Promise<PlatformControls> {
  const result = await env.DB.prepare(`SELECT setting_key, setting_value FROM app_settings
    WHERE setting_key IN (
      'platform_maintenance_enabled',
      'platform_maintenance_reason',
      'platform_maintenance_type',
      'platform_registration_paused',
      'platform_registration_reason'
    )`).all<{ setting_key: string; setting_value: string }>();
  const values = new Map((result.results || []).map((item) => [item.setting_key, item.setting_value]));
  return {
    maintenanceEnabled: values.get("platform_maintenance_enabled") === "true",
    maintenanceReason: values.get("platform_maintenance_reason") || DEFAULT_CONTROLS.maintenanceReason,
    maintenanceType: values.get("platform_maintenance_type") || DEFAULT_CONTROLS.maintenanceType,
    registrationPaused: values.get("platform_registration_paused") === "true",
    registrationReason: values.get("platform_registration_reason") || DEFAULT_CONTROLS.registrationReason,
  };
}

export function maintenanceBlockedResponse(reason: string): Response {
  return new Response(JSON.stringify({
    error: reason || "Attendly is temporarily unavailable while we carry out maintenance.",
    code: "PLATFORM_MAINTENANCE",
    maintenanceMode: true,
    maintenanceReason: reason || "We are carrying out a temporary service update. Please check back soon.",
  }), {
    status: 503,
    headers: { "content-type": "application/json; charset=utf-8", "retry-after": "300", "cache-control": "no-store" },
  });
}
