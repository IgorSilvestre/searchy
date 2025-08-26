-- Create schema, tables, and seed mock data
CREATE SCHEMA IF NOT EXISTS public;

-- Core tables
CREATE TABLE IF NOT EXISTS public.customers (
  id          serial PRIMARY KEY,
  email       text NOT NULL,
  city        text
);

CREATE TABLE IF NOT EXISTS public.orders (
  id           serial PRIMARY KEY,
  customer_id  int REFERENCES public.customers(id),
  total_cents  int NOT NULL,
  paid         boolean DEFAULT true,
  created_at   timestamptz DEFAULT now()
);

-- Make the script idempotent-ish for repeated dev spins
TRUNCATE public.orders, public.customers RESTART IDENTITY;

-- Mock data
INSERT INTO public.customers(email, city) VALUES
  ('a@example.com','floripa'),
  ('b@example.com','floripa'),
  ('c@example.com','porto alegre');

INSERT INTO public.orders(customer_id, total_cents, paid, created_at) VALUES
  (1, 1000, true,  now() - interval '3 days'),
  (1, 2000, true,  now() - interval '2 days'),
  (2, 3000, false, now() - interval '1 day'),
  (3, 4000, true,  now());

-- Read-only application role (matches docker-compose defaults)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN
    CREATE ROLE app_ro LOGIN PASSWORD 'app_ro_pass';
  END IF;
END $$;

GRANT CONNECT ON DATABASE demo TO app_ro;
GRANT USAGE ON SCHEMA public TO app_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_ro;

