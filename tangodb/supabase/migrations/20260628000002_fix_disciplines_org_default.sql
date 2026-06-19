-- RLS INSERT on tenant tables requires organization_id = auth_organization_id().

ALTER TABLE disciplines
  ALTER COLUMN organization_id SET DEFAULT auth_organization_id();

ALTER TABLE locations
  ALTER COLUMN organization_id SET DEFAULT auth_organization_id();

ALTER TABLE clients
  ALTER COLUMN organization_id SET DEFAULT auth_organization_id();

ALTER TABLE subscriptions
  ALTER COLUMN organization_id SET DEFAULT auth_organization_id();

ALTER TABLE personal_lessons
  ALTER COLUMN organization_id SET DEFAULT auth_organization_id();

ALTER TABLE schedule_slots
  ALTER COLUMN organization_id SET DEFAULT auth_organization_id();
