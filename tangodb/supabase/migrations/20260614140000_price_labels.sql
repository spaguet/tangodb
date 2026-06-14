-- Custom labels and descriptions for price tariffs
ALTER TABLE prices ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE prices ADD COLUMN IF NOT EXISTS description TEXT;

UPDATE prices SET label = 'Соло Абонемент (4 урока)', description = 'Групповые занятия, полмесяца'
WHERE type = 'solo' AND lessons = 4 AND label IS NULL;

UPDATE prices SET label = 'Соло Абонемент (8 уроков)', description = 'Групповые занятия, один месяц'
WHERE type = 'solo' AND lessons = 8 AND label IS NULL;

UPDATE prices SET label = 'Парный Абонемент (4 урока)', description = 'Групповые занятия, полмесяца'
WHERE type = 'pair_hm' AND label IS NULL;

UPDATE prices SET label = 'Парный — Месяц 1 (8 уроков)', description = 'Групповые занятия, первый цикл'
WHERE type = 'pair_m1' AND label IS NULL;

UPDATE prices SET label = 'Парный — Месяц 2 (8 уроков)', description = 'Групповые занятия, второй цикл'
WHERE type = 'pair_m2' AND label IS NULL;

UPDATE prices SET label = 'Парный — Месяц 3 (8 уроков)', description = 'Групповые занятия, третий цикл'
WHERE type = 'pair_m3' AND label IS NULL;

UPDATE prices SET label = 'Индивидуальный Соло Урок', description = 'Приватная сессия (1 клиент)'
WHERE type = 'personal_solo' AND label IS NULL;

UPDATE prices SET label = 'Индивидуальный Парный Урок', description = 'Приватная сессия (2 клиента)'
WHERE type = 'personal_pair' AND label IS NULL;

UPDATE prices SET label = 'Индивидуальный Трио Урок', description = 'Приватная сессия (3 клиента)'
WHERE type = 'personal_trio' AND label IS NULL;
