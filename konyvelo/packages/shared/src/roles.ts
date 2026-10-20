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
  CHIEF_ACCOUNTANT: "Könyvel, kezeli a számlatükröt és az üzleti éveket, lezárja az időszakokat, látja az audit naplót.",
  ACCOUNTANT: "Bizonylatokat rögzít és könyvel, partnereket kezel.",
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
  "accounts:manage",
  "partners:manage",
  "audit:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  CHIEF_ACCOUNTANT: [
    "company:read",
    "company:update",
    "fiscalYear:manage",
    "period:close",
    "ledger:post",
    "accounts:manage",
    "partners:manage",
    "audit:read",
  ],
  ACCOUNTANT: ["company:read", "ledger:post", "partners:manage"],
  VIEWER: ["company:read"],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function permissionsOf(role: Role): readonly Permission[] {
  return MATRIX[role];
}
