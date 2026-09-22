-- ============================================================
-- Prima CMMS – Schema v2
-- Im SQL-Editor von Supabase vollständig ausführen.
-- ACHTUNG: ersetzt die Tabellen aus v1 samt Inhalt.
-- ============================================================

create extension if not exists "pgcrypto";

drop table if exists order_media, checklist_items, work_orders, qm_records,
  machine_checklists, machine_media, machines, rooms, departments cascade;
drop view if exists machines_due, v_downtime, v_downtime_by_machine, v_failure_causes cascade;

do $$ begin
  create type user_role      as enum ('QM', 'Technik');
  create type order_kind     as enum ('planmaessig', 'unplanmaessig');
  create type order_state    as enum ('offen', 'in_bearbeitung', 'fertig_zur_abnahme', 'abgeschlossen');
  create type priority_level as enum ('niedrig', 'mittel', 'hoch', 'kritisch');
  create type machine_state  as enum ('in_betrieb', 'stillstand');
  create type cycle_kind     as enum ('taeglich', 'woechentlich', 'monatlich', 'quartalsweise', 'jaehrlich');
  create type media_kind     as enum ('anleitung', 'foto', 'dokument');
  create type qm_kind        as enum ('maengelmeldung', 'pruefprotokoll');
exception when duplicate_object then null; end $$;

-- ---------- Benutzer ----------------------------------------------
create table if not exists profiles (
  id         uuid primary key references auth.users on delete cascade,
  full_name  text not null default '',
  role       user_role not null default 'Technik',
  created_at timestamptz not null default now()
);

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, role) values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'Technik'))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create or replace function current_role_name() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

-- ---------- Struktur: Abteilung > Raum > Maschine ------------------
create table departments (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table rooms (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments on delete cascade,
  name          text not null,
  unique (department_id, name)
);

create table machines (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references rooms on delete restrict,
  name             text not null,
  manufacturer     text,
  cycle            cycle_kind,
  last_maintenance date,
  spare_parts      text[] not null default '{}',
  notes            text,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- Maschinenspezifische Wartungs-Checkliste (Vorlage)
create table machine_checklists (
  id         uuid primary key default gen_random_uuid(),
  machine_id uuid not null references machines on delete cascade,
  label      text not null,
  position   int not null default 0
);

create table machine_media (
  id          uuid primary key default gen_random_uuid(),
  machine_id  uuid not null references machines on delete cascade,
  kind        media_kind not null default 'dokument',
  file_path   text not null,
  file_name   text not null,
  uploaded_by uuid references profiles,
  created_at  timestamptz not null default now()
);

create or replace view machines_due as
  select m.*, r.name as room_name, r.department_id, d.name as department_name,
         case m.cycle
           when 'taeglich'      then coalesce(m.last_maintenance, m.created_at::date) + interval '1 day'
           when 'woechentlich'  then coalesce(m.last_maintenance, m.created_at::date) + interval '7 days'
           when 'monatlich'     then coalesce(m.last_maintenance, m.created_at::date) + interval '1 month'
           when 'quartalsweise' then coalesce(m.last_maintenance, m.created_at::date) + interval '3 months'
           when 'jaehrlich'     then coalesce(m.last_maintenance, m.created_at::date) + interval '1 year'
         end::date as next_due
  from machines m
  join rooms r on r.id = m.room_id
  join departments d on d.id = r.department_id;

-- ---------- Aufträge ----------------------------------------------
create sequence if not exists order_no_seq start 1000;

create table work_orders (
  id             uuid primary key default gen_random_uuid(),
  order_no       int not null default nextval('order_no_seq'),
  kind           order_kind not null,
  title          text not null,
  description    text,
  priority       priority_level not null default 'mittel',
  status         order_state not null default 'offen',

  machine_id     uuid references machines on delete restrict,   -- optional: reiner Raumauftrag
  room_id        uuid not null references rooms on delete restrict,

  machine_status machine_state not null default 'in_betrieb',
  fault_reason   text,
  downtime_start timestamptz,
  downtime_end   timestamptz,
  downtime_hours numeric(8,2) not null default 0,

  cycle          cycle_kind,
  due_date       date,

  repair_date    date,
  replaced_parts text[] not null default '{}',
  notes          text,
  qm_notes       text,
  rejected_count int not null default 0,

  created_by   uuid references profiles,
  assigned_to  uuid references profiles,
  completed_by uuid references profiles,
  completed_at timestamptz,
  approved_by  uuid references profiles,
  approved_at  timestamptz,
  created_at   timestamptz not null default now(),

  constraint stillstand_braucht_grund
    check (machine_status = 'in_betrieb' or nullif(trim(coalesce(fault_reason,'')), '') is not null)
);

create index on work_orders (status);
create index on work_orders (kind);
create index on work_orders (machine_id);
create index on work_orders (room_id);

create table checklist_items (
  id       uuid primary key default gen_random_uuid(),
  order_id uuid not null references work_orders on delete cascade,
  label    text not null,
  done     boolean not null default false,
  done_by  uuid references profiles,
  done_at  timestamptz,
  position int not null default 0
);

create table order_media (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references work_orders on delete cascade,
  file_path   text not null,
  file_name   text not null,
  uploaded_by uuid references profiles,
  created_at  timestamptz not null default now()
);

create table qm_records (
  id          uuid primary key default gen_random_uuid(),
  kind        qm_kind not null,
  title       text not null,
  body        text,
  machine_id  uuid references machines on delete set null,
  order_id    uuid references work_orders on delete set null,
  released    boolean not null default false,
  released_by uuid references profiles,
  released_at timestamptz,
  created_by  uuid references profiles,
  created_at  timestamptz not null default now()
);

-- ---------- Ausfallzeit: Uhr läuft ab Erstellung -------------------
create or replace function track_downtime() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.machine_status = 'stillstand' then
      new.downtime_start := coalesce(new.downtime_start, now());
    end if;
    return new;
  end if;

  if new.machine_status = 'stillstand' and old.machine_status = 'in_betrieb' then
    new.downtime_start := coalesce(new.downtime_start, now());
    new.downtime_end := null;
  end if;

  if new.machine_status = 'in_betrieb' and old.machine_status = 'stillstand' then
    new.downtime_end := coalesce(new.downtime_end, now());
    if new.downtime_start is not null then
      new.downtime_hours := round(extract(epoch from (new.downtime_end - new.downtime_start)) / 3600.0, 2);
    end if;
  end if;
  return new;
end $$;

create trigger work_orders_downtime
  before insert or update on work_orders
  for each row execute function track_downtime();

-- ---------- Vier-Augen-Prinzip, Abnahme, Beanstandung --------------
create or replace function enforce_four_eyes() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid();
begin
  if new.status = 'fertig_zur_abnahme' and old.status is distinct from 'fertig_zur_abnahme' then
    new.completed_by := coalesce(new.completed_by, actor);
    new.completed_at := now();
    new.approved_by := null; new.approved_at := null;
  end if;

  -- Beanstandung: zurück auf Offen, Notiz ist Pflicht
  if new.status = 'offen' and old.status = 'fertig_zur_abnahme' then
    if nullif(trim(coalesce(new.qm_notes,'')), '') is null then
      raise exception 'Bei einer Beanstandung muss eine Notiz für die Technik hinterlegt werden.' using errcode='P0004';
    end if;
    if old.completed_by = actor then
      raise exception 'Vier-Augen-Prinzip: Die eigene Fertigmeldung kann nicht selbst beanstandet werden.' using errcode='P0002';
    end if;
    new.rejected_count := old.rejected_count + 1;
    new.completed_by := null; new.completed_at := null;
  end if;

  if new.status = 'abgeschlossen' and old.status is distinct from 'abgeschlossen' then
    if old.status <> 'fertig_zur_abnahme' then
      raise exception 'Abnahme nur möglich, wenn der Auftrag fertig zur Abnahme gemeldet ist.' using errcode='P0001';
    end if;
    if old.completed_by is not null and old.completed_by = actor then
      raise exception 'Vier-Augen-Prinzip: Der Auftrag wurde von dieser Person fertig gemeldet und kann nicht von ihr abgenommen werden.' using errcode='P0002';
    end if;
    new.approved_by := actor;
    new.approved_at := now();
    if new.kind = 'planmaessig' and new.machine_id is not null then
      update machines set last_maintenance = coalesce(new.repair_date, current_date) where id = new.machine_id;
    end if;
  end if;

  if new.status <> 'abgeschlossen' then
    new.approved_by := null; new.approved_at := null;
  end if;
  return new;
end $$;

create trigger work_orders_four_eyes
  before update on work_orders
  for each row execute function enforce_four_eyes();

create or replace function enforce_qm_release() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid();
begin
  if new.released and not old.released then
    if current_role_name() <> 'QM' then
      raise exception 'Freigabe ist dem Qualitätsmanagement vorbehalten.' using errcode='P0003';
    end if;
    if old.created_by = actor then
      raise exception 'Vier-Augen-Prinzip: Eigene Meldungen können nicht selbst freigegeben werden.' using errcode='P0002';
    end if;
    new.released_by := actor; new.released_at := now();
  end if;
  return new;
end $$;

create trigger qm_records_release before update on qm_records
  for each row execute function enforce_qm_release();

-- ---------- Checkliste der Maschine in Auftrag kopieren ------------
create or replace function copy_checklist(p_order uuid, p_machine uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into checklist_items (order_id, label, position)
    select p_order, label, position from machine_checklists where machine_id = p_machine order by position;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Fällige Wartungen automatisch erzeugen -----------------
create or replace function generate_due_maintenance() returns int
language plpgsql security definer set search_path = public as $$
declare created int := 0; m record; neu uuid;
begin
  for m in
    select * from machines_due d
     where d.active and d.cycle is not null and d.next_due <= current_date + 14
       and not exists (select 1 from work_orders w
                        where w.machine_id = d.id and w.kind = 'planmaessig' and w.status <> 'abgeschlossen')
  loop
    insert into work_orders (kind, title, description, priority, machine_id, room_id, cycle, due_date, created_by)
    values ('planmaessig',
            m.name || ' - ' || to_char(m.next_due, 'DD.MM.YYYY'),
            'Automatisch erzeugt nach Wartungszyklus.',
            'mittel', m.id, m.room_id, m.cycle, m.next_due, auth.uid())
    returning id into neu;
    perform copy_checklist(neu, m.id);
    created := created + 1;
  end loop;
  return created;
end $$;

-- ---------- Auswertungen -------------------------------------------
create or replace view v_downtime as
  select w.id, w.order_no, w.title, w.fault_reason, w.downtime_start, w.downtime_end,
         w.downtime_hours, w.machine_status, w.status, w.created_at,
         m.id as machine_id, m.name as machine_name,
         r.name as room_name, d.name as department_name
    from work_orders w
    join rooms r on r.id = w.room_id
    join departments d on d.id = r.department_id
    left join machines m on m.id = w.machine_id
   where w.downtime_start is not null;

-- ---------- RLS -----------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','departments','rooms','machines','machine_checklists',
                           'machine_media','work_orders','checklist_items','order_media','qm_records'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "lesen" on %I', t);
    execute format('create policy "lesen" on %I for select to authenticated using (true)', t);
  end loop;
  foreach t in array array['departments','rooms','machines','machine_checklists','machine_media',
                           'work_orders','checklist_items','order_media','qm_records'] loop
    execute format('drop policy if exists "anlegen" on %I', t);
    execute format('create policy "anlegen" on %I for insert to authenticated with check (true)', t);
    execute format('drop policy if exists "aendern" on %I', t);
    execute format('create policy "aendern" on %I for update to authenticated using (true) with check (true)', t);
    execute format('drop policy if exists "loeschen" on %I', t);
    execute format('create policy "loeschen" on %I for delete to authenticated using (true)', t);
  end loop;
end $$;

drop policy if exists "profil_selbst" on profiles;
create policy "profil_selbst" on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------- Storage --------------------------------------------------
insert into storage.buckets (id, name, public) values ('maschinen-medien','maschinen-medien',true)
on conflict (id) do nothing;

drop policy if exists "medien_lesen" on storage.objects;
create policy "medien_lesen" on storage.objects for select using (bucket_id='maschinen-medien');
drop policy if exists "medien_hochladen" on storage.objects;
create policy "medien_hochladen" on storage.objects for insert to authenticated with check (bucket_id='maschinen-medien');
drop policy if exists "medien_loeschen" on storage.objects;
create policy "medien_loeschen" on storage.objects for delete to authenticated using (bucket_id='maschinen-medien');

do $$ begin
  alter publication supabase_realtime add table work_orders;
exception when duplicate_object then null; end $$;
