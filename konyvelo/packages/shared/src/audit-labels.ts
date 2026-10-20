/** Az audit napló műveleteinek magyar megnevezése a felülethez. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "user.create": "Felhasználó létrehozása",
  "user.password_change": "Jelszócsere",
  "company.create": "Cég létrehozása",
  "company.update": "Cégadatok módosítása",
  "member.add": "Felhasználó hozzáadása a céghez",
  "member.update": "Szerepkör módosítása",
  "member.remove": "Felhasználó eltávolítása a cégből",
  "fiscal_year.create": "Üzleti év létrehozása",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
