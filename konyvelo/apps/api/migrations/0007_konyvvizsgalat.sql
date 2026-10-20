-- Könyvvizsgálat (Szt. 154. § (3)): ha a közzétett beszámolót könyvvizsgáló nem
-- ellenőrizte, a mérlegen, az eredménykimutatáson és a kiegészítő mellékleten
-- fel kell tüntetni: „A közzétett adatok könyvvizsgálattal nincsenek alátámasztva.”
ALTER TABLE companies ADD COLUMN audited boolean NOT NULL DEFAULT false;
