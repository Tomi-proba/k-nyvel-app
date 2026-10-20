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
  "accounts.load_default": "Alapértelmezett számlatükör betöltése",
  "account.create": "Főkönyvi számla létrehozása",
  "account.update": "Főkönyvi számla módosítása",
  "account.delete": "Főkönyvi számla törlése",
  "partner.create": "Partner létrehozása",
  "partner.update": "Partner módosítása",
  "partner.delete": "Partner törlése",
  "document.create": "Bizonylat-piszkozat létrehozása",
  "document.update": "Bizonylat-piszkozat módosítása",
  "document.delete": "Bizonylat-piszkozat törlése",
  "document.post": "Bizonylat könyvelése",
  "document.reverse": "Bizonylat sztornózása",
  "templates.load_default": "Alapértelmezett kontírozási sablonok betöltése",
  "template.create": "Kontírozási sablon létrehozása",
  "template.update": "Kontírozási sablon módosítása",
  "template.delete": "Kontírozási sablon törlése",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
