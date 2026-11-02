create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  role text not null check (role in ('marketing','designer','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.designs (
  id uuid primary key default gen_random_uuid(),
  project_name text not null,
  apparel_type text not null,
  deadline date,
  main_color text,
  brief text not null,
  status text not null default 'queued' check (status in ('queued','claimed','submitted','approved')),
  created_by uuid not null references public.profiles(id),
  assigned_to uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.design_files (
  id uuid primary key default gen_random_uuid(),
  design_id uuid not null references public.designs(id) on delete cascade,
  file_type text not null check (file_type in ('reference','result')),
  file_name text not null,
  drive_file_id text not null,
  drive_url text not null,
  preview_url text,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists designs_status_idx on public.designs(status, created_at);
create index if not exists designs_assigned_idx on public.designs(assigned_to);

alter table public.profiles enable row level security;
alter table public.designs enable row level security;
alter table public.design_files enable row level security;

create or replace function public.current_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create policy "profiles readable by authenticated" on public.profiles
for select to authenticated using (true);

create policy "designs read for authenticated" on public.designs
for select to authenticated using (true);

create policy "marketing and admin create designs" on public.designs
for insert to authenticated with check (
  created_by = auth.uid() and public.current_role() in ('marketing','admin')
);

create policy "marketing own delete and admin delete" on public.designs
for delete to authenticated using (
  public.current_role() = 'admin' or
  (public.current_role() = 'marketing' and created_by = auth.uid() and status <> 'approved')
);

create policy "admin or assigned designer update designs" on public.designs
for update to authenticated using (
  public.current_role() = 'admin' or
  (public.current_role() = 'designer' and assigned_to = auth.uid())
) with check (
  public.current_role() = 'admin' or
  (public.current_role() = 'designer' and assigned_to = auth.uid())
);

create policy "files read authenticated" on public.design_files
for select to authenticated using (true);

create policy "upload files by marketing/designer/admin" on public.design_files
for insert to authenticated with check (
  uploaded_by = auth.uid() and public.current_role() in ('marketing','designer','admin')
);

-- Claim atomik: hanya satu desainer yang dapat mengambil setiap brief.
create or replace function public.claim_design(p_design_id uuid)
returns public.designs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_design public.designs;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('designer','admin') then
    raise exception 'Hanya desainer atau admin yang dapat mengambil antrian';
  end if;

  update public.designs
  set status = 'claimed', assigned_to = auth.uid(), updated_at = now()
  where id = p_design_id and status = 'queued'
  returning * into v_design;

  if not found then
    raise exception 'Brief sudah diambil desainer lain atau tidak tersedia';
  end if;
  return v_design;
end;
$$;

grant execute on function public.claim_design(uuid) to authenticated;
