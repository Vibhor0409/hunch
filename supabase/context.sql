-- Context.dev add-on tables. Apply once after schema.sql.

create table if not exists card_context (
  cache_key text primary key,          -- event series when present, else event ticker
  text text,                           -- null means "no usable context" (negative cache)
  source_title text,
  source_url text,
  source_domain text,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists context_usage (
  day date primary key,                -- America/Los_Angeles calendar day
  calls integer not null default 0,
  credits_used integer not null default 0,
  last_credits_remaining integer,
  updated_at timestamptz not null default now()
);

alter table card_context enable row level security;
alter table context_usage enable row level security;
