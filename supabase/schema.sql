-- Hunch schema. Apply once (Supabase MCP or SQL editor).
-- Server uses the service role key; RLS is on with no policies, so anon access is denied.

create extension if not exists pgcrypto;

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists players_name_lower_idx on players (lower(name));

create table if not exists swipes (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  event_ticker text not null,
  instrument_symbol text not null,
  question text not null,
  category text not null,
  lane text not null check (lane in ('live', 'tomorrow', 'week', 'later')),
  side text not null check (side in ('yes', 'no')),
  price numeric(6,4) not null check (price > 0 and price < 1),
  mode text not null check (mode in ('paid', 'practice')),
  stake numeric(8,2) not null default 0,
  contracts numeric(10,2) not null default 0,
  order_id text,
  order_status text,
  expires_at timestamptz not null,
  settled boolean not null default false,
  won boolean,
  edge numeric(6,1),
  payout numeric(8,2),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (player_id, instrument_symbol)
);
create index if not exists swipes_unsettled_idx on swipes (settled, expires_at);
create index if not exists swipes_player_idx on swipes (player_id, created_at desc);

alter table players enable row level security;
alter table swipes enable row level security;

create or replace view leaderboard as
select
  p.id as player_id,
  p.name,
  coalesce(sum(s.edge) filter (where s.settled), 0)::numeric(8,1) as edge_total,
  count(s.id) filter (where s.settled) as settled_calls,
  count(s.id) as total_calls
from players p
left join swipes s on s.player_id = p.id
group by p.id, p.name;

-- Feed snapshot (added 4:05 PM): the latest card list, so cold API instances answer instantly.
create table if not exists feed_snapshot (
  key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table feed_snapshot enable row level security;

-- Play-money wallet (F8, added 4:20 PM). Balance moves with every paid swipe and settlement.
alter table players add column if not exists balance numeric(12,2) not null default 1000.00;
alter table players add column if not exists stake_per_trade numeric(8,2) not null default 1.00 check (stake_per_trade >= 1 and stake_per_trade <= 100);
create table if not exists wallet_tx (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  swipe_id uuid references swipes(id) on delete set null,
  kind text not null check (kind in ('stake', 'payout', 'reset')),
  amount numeric(12,2) not null,
  balance_after numeric(12,2) not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists wallet_tx_player_idx on wallet_tx (player_id, created_at desc);
alter table wallet_tx enable row level security;
create or replace function adjust_balance(p_player uuid, p_delta numeric) returns numeric language sql as $$
  update players set balance = balance + p_delta where id = p_player returning balance;
$$;
