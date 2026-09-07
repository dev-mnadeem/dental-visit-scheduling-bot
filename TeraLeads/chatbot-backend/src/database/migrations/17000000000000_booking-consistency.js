exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS booking_request_id TEXT;
    ALTER TABLE appointments ALTER COLUMN duration_minutes SET NOT NULL;
    ALTER TABLE appointments ALTER COLUMN status SET NOT NULL;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'appointments'::regclass AND conname = 'booking_request_unique') THEN
        ALTER TABLE appointments ADD CONSTRAINT booking_request_unique UNIQUE (user_id, booking_request_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'appointments'::regclass AND conname = 'valid_duration') THEN
        ALTER TABLE appointments ADD CONSTRAINT valid_duration CHECK (duration_minutes BETWEEN 1 AND 480);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'appointments'::regclass AND conname = 'no_active_overlap') THEN
        ALTER TABLE appointments ADD CONSTRAINT no_active_overlap EXCLUDE USING gist (
          tsrange(date + time, date + time + duration_minutes * interval '1 minute', '[)') WITH &&
        ) WHERE (status IN ('pending', 'confirmed'));
      END IF;
    END $$;
  `)
}

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE appointments DROP CONSTRAINT IF EXISTS no_active_overlap;
    ALTER TABLE appointments DROP CONSTRAINT IF EXISTS valid_duration;
    ALTER TABLE appointments DROP CONSTRAINT IF EXISTS booking_request_unique;
    ALTER TABLE appointments DROP COLUMN IF EXISTS booking_request_id;
  `)
}
