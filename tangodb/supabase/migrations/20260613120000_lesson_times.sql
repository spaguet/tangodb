-- Add start/end times for personal lessons and end time for group schedule slots

ALTER TABLE personal_lessons
  ADD COLUMN IF NOT EXISTS time_start TEXT NOT NULL DEFAULT '14:00',
  ADD COLUMN IF NOT EXISTS time_end   TEXT NOT NULL DEFAULT '15:00';

ALTER TABLE schedule
  ADD COLUMN IF NOT EXISTS time_end TEXT NOT NULL DEFAULT '21:00';

UPDATE personal_lessons
SET time_start = '14:00', time_end = '15:00'
WHERE time_start IS NULL OR time_start = '' OR time_end IS NULL OR time_end = '';

UPDATE schedule
SET time_end = '21:00'
WHERE time_end IS NULL OR time_end = '';
