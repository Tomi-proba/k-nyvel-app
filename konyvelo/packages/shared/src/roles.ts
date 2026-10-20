/**
 * Szerepkörök és jogosultságok (PLAN 4.1). A jogosultság mindig egy adott
 * céghez tartozik: ugyanaz a felhasználó lehet az egyik cégben
 * Adminisztrátor, a másikban Megtekintő.
 */

export const ROLES = ["ADMIN", "CHIEF_ACCOUNTANT", "ACCOUNTANT", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Adminisztrátor",
  CHIEF_ACCOUNTANT: "Vezető könyvelő",
  ACCOUNTANT: "Könyvelő",
  VIEWER: "Megtekintő",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: "Mindent megtehet: cégadatok, felhasználók, zárás feloldása, audit napló.",
  CHIEF_ACCOUNTANT: "Könyvel, kezeli az üzleti éveket, lezárja az időszakokat, látja az audit naplót.",
  ACCOUNTANT: "Bizonylatokat rögzít és könyvel.",
  VIEWER: "Csak megtekintheti az adatokat és a kimutatásokat.",
};

export const PERMISSIONS = [
  "company:read",
  "company:update",
  "members:manage",
  "fiscalYear:manage",
  "period:close",
  "period:reopen",
  "ledger:post",
  "audit:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  CHIEF_ACCOUNTANT: ["company:read", "company:update", "fiscalYear:manage", "period:close", "ledger:post", "audit:read"],
  ACCOUNTANT: ["company:read", "ledger:post"],
  VIEWER: ["company:read"],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function permissionsOf(role: Role): readonly Permission[] {
  return MATRIX[role];
}
