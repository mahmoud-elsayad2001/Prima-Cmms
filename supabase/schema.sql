-- ============================================================
-- Prima CMMS – Datenbankschema v3
-- IDEMPOTENT: Dieses Skript kann auf einer leeren Datenbank UND auf dem
-- bestehenden Stand (v2) beliebig oft im Supabase SQL-Editor ausgeführt
-- werden. Es werden keine Daten gelöscht.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- ENUM-Typen (jeder einzeln, damit ein vorhandener Typ die übrigen nicht blockiert)
do $$ begin create type user_role      as enum ('QM', 'Technik'); exception when duplicate_object then null; end $$;
do $$ begin create type order_kind     as enum ('planmaessig', 'unplanmaessig'); exception when duplicate_object then null; end $$;
do $$ begin create type order_state    as enum ('offen', 'in_bearbeitung', 'fertig_zur_abnahme', 'abgeschlossen'); exception when duplicate_object then null; end $$;
do $$ begin create type priority_level as enum ('niedrig', 'mittel', 'hoch', 'kritisch'); exception when duplicate_object then null; end $$;
do $$ begin create type machine_state  as enum ('in_betrieb', 'stillstand'); exception when duplicate_object then null; end $$;
do $$ begin create type cycle_kind     as enum ('taeglich', 'woechentlich', 'monatlich', 'quartalsweise', 'jaehrlich'); exception when duplicate_object then null; end $$;
do $$ begin create type media_kind     as enum ('anleitung', 'foto', 'dokument'); exception when duplicate_object then null; end $$;
do $$ begin create type qm_kind        as enum ('maengelmeldung', 'pruefprotokoll'); exception when duplicate_object then null; end $$;
do $$ begin create type fault_cause_kind as enum
  ('verschleiss', 'bedienfehler', 'materialfehler', 'elektronik', 'software', 'mechanik', 'hydraulik_pneumatik', 'sonstiges');
exception when duplicate_object then null; end $$;

-- Fehlende Werte in bereits vorhandenen Typen nachziehen (z. B. Reste aus Version 1)
alter type order_state add value if not exists 'abgeschlossen';
alter type media_kind  add value if not exists 'foto';
alter type fault_cause_kind add value if not exists 'verschleiss';
alter type fault_cause_kind add value if not exists 'bedienfehler';
alter type fault_cause_kind add value if not exists 'materialfehler';
alter type fault_cause_kind add value if not exists 'elektronik';
alter type fault_cause_kind add value if not exists 'software';
alter type fault_cause_kind add value if not exists 'mechanik';
alter type fault_cause_kind add value if not exists 'hydraulik_pneumatik';
alter type fault_cause_kind add value if not exists 'sonstiges';

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
create table if not exists departments (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table if not exists rooms (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments on delete cascade,
  name          text not null,
  unique (department_id, name)
);

create table if not exists machines (
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

create table if not exists machine_checklists (
  id         uuid primary key default gen_random_uuid(),
  machine_id uuid not null references machines on delete cascade,
  label      text not null,
  position   int not null default 0
);

create table if not exists machine_media (
  id          uuid primary key default gen_random_uuid(),
  machine_id  uuid not null references machines on delete cascade,
  kind        media_kind not null default 'dokument',
  file_path   text not null,
  file_name   text not null,
  uploaded_by uuid references profiles,
  created_at  timestamptz not null default now()
);

-- ---------- Aufträge ----------------------------------------------
create sequence if not exists order_no_seq start 1000;

create table if not exists work_orders (
  id             uuid primary key default gen_random_uuid(),
  order_no       int not null default nextval('order_no_seq'),
  kind           order_kind not null,
  title          text not null,
  description    text,
  priority       priority_level not null default 'mittel',
  status         order_state not null default 'offen',

  machine_id     uuid references machines on delete restrict,   -- optional: reiner Raumauftrag
  room_id        uuid not null references rooms on delete restrict,

  -- Ausfallzeit der Maschine
  machine_status machine_state not null default 'in_betrieb',
  fault_cause    fault_cause_kind,                               -- Grund der Störung (Auswahl)
  fault_reason   text,                                           -- Erläuterung (Freitext)
  downtime_start timestamptz,
  downtime_end   timestamptz,
  downtime_hours numeric(10,4) not null default 0,

  -- Reparatur-/Wartungszeit (Stoppuhr)
  work_first_started_at timestamptz,
  work_started_at       timestamptz,
  work_ended_at         timestamptz,
  work_seconds          integer not null default 0,
  work_started_by       uuid references profiles,

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
  created_at   timestamptz not null default now()
);

-- Bestehende Installationen (v2) um die neuen Spalten erweitern
alter table work_orders add column if not exists fault_cause           fault_cause_kind;
alter table work_orders add column if not exists work_first_started_at timestamptz;
alter table work_orders add column if not exists work_started_at       timestamptz;
alter table work_orders add column if not exists work_ended_at         timestamptz;
alter table work_orders add column if not exists work_seconds          integer not null default 0;
alter table work_orders add column if not exists work_started_by       uuid references profiles;
alter table work_orders add column if not exists qm_notes              text;
alter table work_orders add column if not exists rejected_count        int not null default 0;

-- Views vor Typänderung entfernen (werden unten neu angelegt)
drop view if exists v_downtime;
drop view if exists machines_due;
drop view if exists v_downtime_by_machine, v_failure_causes cascade;

-- Sekundengenaue Ausfallzeit: 4 Nachkommastellen Stunden = 0,36 s
alter table work_orders alter column downtime_hours type numeric(10,4);

-- Stillstand braucht einen Grund: Auswahl ODER Erläuterung
alter table work_orders drop constraint if exists stillstand_braucht_grund;
alter table work_orders add constraint stillstand_braucht_grund check (
  machine_status = 'in_betrieb'
  or fault_cause is not null
  or nullif(trim(coalesce(fault_reason, '')), '') is not null
);

create index if not exists work_orders_status_idx  on work_orders (status);
create index if not exists work_orders_kind_idx    on work_orders (kind);
create index if not exists work_orders_machine_idx on work_orders (machine_id);
create index if not exists work_orders_room_idx    on work_orders (room_id);

create table if not exists checklist_items (
  id       uuid primary key default gen_random_uuid(),
  order_id uuid not null references work_orders on delete cascade,
  label    text not null,
  done     boolean not null default false,
  done_by  uuid references profiles,
  done_at  timestamptz,
  position int not null default 0
);

create table if not exists order_media (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references work_orders on delete cascade,
  file_path   text not null,
  file_name   text not null,
  uploaded_by uuid references profiles,
  created_at  timestamptz not null default now()
);

create table if not exists qm_records (
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

-- ---------- Altdaten angleichen (schlägt nie fehl, ändert nur was passt) ----
do $$
begin
  -- Störungsgrund aus altem Freitext in die Auswahl übernehmen
  update work_orders set fault_cause = (case
      when fault_reason ilike '%verschlei%'                                        then 'verschleiss'
      when fault_reason ilike '%bedien%'                                           then 'bedienfehler'
      when fault_reason ilike '%material%' or fault_reason ilike '%stau%'          then 'materialfehler'
      when fault_reason ilike '%elektr%' or fault_reason ilike '%antrieb%'
        or fault_reason ilike '%sensor%'                                           then 'elektronik'
      when fault_reason ilike '%software%' or fault_reason ilike '%sps%'
        or fault_reason ilike '%steuerung%'                                        then 'software'
      when fault_reason ilike '%hydraul%' or fault_reason ilike '%pneum%'
        or fault_reason ilike '%undicht%'                                          then 'hydraulik_pneumatik'
      when fault_reason ilike '%lager%' or fault_reason ilike '%mechan%'           then 'mechanik'
      else 'sonstiges' end)::fault_cause_kind
   where fault_cause is null and nullif(trim(coalesce(fault_reason, '')), '') is not null;

  -- Abgeschlossene Aufträge dürfen nicht dauerhaft im Stillstand hängen
  update work_orders
     set machine_status = 'in_betrieb',
         downtime_end   = coalesce(downtime_end, approved_at, now())
   where status = 'abgeschlossen' and machine_status = 'stillstand';
exception when others then
  raise notice 'Altdaten-Angleichung übersprungen: %', sqlerrm;
end $$;

-- ---------- Ausfallzeit: Uhr läuft ab Erstellung ---------------------
create or replace function track_downtime() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.machine_status = 'stillstand' then
      new.downtime_start := coalesce(new.downtime_start, now());
    end if;
    return new;
  end if;

  -- Mit der Abnahme endet ein noch laufender Stillstand
  if new.status = 'abgeschlossen' and old.status is distinct from 'abgeschlossen'
     and new.machine_status = 'stillstand' then
    new.machine_status := 'in_betrieb';
  end if;

  if new.machine_status = 'stillstand' and old.machine_status = 'in_betrieb' then
    new.downtime_start := coalesce(new.downtime_start, now());
    new.downtime_end := null;
  end if;

  if new.machine_status = 'in_betrieb' and old.machine_status = 'stillstand' then
    new.downtime_end := coalesce(new.downtime_end, now());
    if new.downtime_start is not null then
      new.downtime_hours := round(extract(epoch from (new.downtime_end - new.downtime_start)) / 3600.0, 4);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists work_orders_downtime on work_orders;
create trigger work_orders_downtime
  before insert or update on work_orders
  for each row execute function track_downtime();

-- ---------- Reparaturzeit: Stoppuhr am Auftrag ----------------------
-- Start beim Wechsel auf "in Bearbeitung", Stopp beim Verlassen dieses Status
-- (Fertigmelden). Mehrere Durchläufe (z. B. nach Beanstandung) werden addiert.
-- Angemeldete Benutzer können die Zeitfelder nicht direkt überschreiben.
create or replace function track_work_time() returns trigger
language plpgsql set search_path = public as $$
declare actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if new.status = 'in_bearbeitung' then
      new.work_started_at       := now();
      new.work_first_started_at := now();
      new.work_started_by       := actor;
    else
      new.work_started_at := null; new.work_first_started_at := null;
      new.work_started_by := null;
    end if;
    new.work_ended_at := null;
    new.work_seconds  := 0;
    return new;
  end if;

  if actor is not null then
    new.work_first_started_at := old.work_first_started_at;
    new.work_started_at       := old.work_started_at;
    new.work_ended_at         := old.work_ended_at;
    new.work_seconds          := old.work_seconds;
    new.work_started_by       := old.work_started_by;
  end if;

  -- Start
  if new.status = 'in_bearbeitung' and old.status is distinct from 'in_bearbeitung' then
    new.work_started_at       := now();
    new.work_first_started_at := coalesce(old.work_first_started_at, now());
    new.work_started_by       := coalesce(actor, old.work_started_by);
    new.work_ended_at         := null;
  end if;

  -- Stopp
  if old.status = 'in_bearbeitung' and new.status is distinct from 'in_bearbeitung'
     and old.work_started_at is not null and old.work_ended_at is null then
    new.work_ended_at := now();
    new.work_seconds  := coalesce(old.work_seconds, 0)
                         + greatest(0, round(extract(epoch from (now() - old.work_started_at)))::int);
  end if;

  return new;
end $$;

drop trigger if exists work_orders_worktime on work_orders;
create trigger work_orders_worktime
  before insert or update on work_orders
  for each row execute function track_work_time();

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

drop trigger if exists work_orders_four_eyes on work_orders;
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

drop trigger if exists qm_records_release on qm_records;
create trigger qm_records_release before update on qm_records
  for each row execute function enforce_qm_release();

-- ---------- Views ----------------------------------------------------
create view machines_due as
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

create view v_downtime as
  select w.id, w.order_no, w.title, w.kind, w.status, w.fault_cause, w.fault_reason,
         w.downtime_start, w.downtime_end, w.downtime_hours, w.machine_status, w.created_at,
         m.id as machine_id, m.name as machine_name,
         r.name as room_name, d.name as department_name
    from work_orders w
    join rooms r on r.id = w.room_id
    join departments d on d.id = r.department_id
    left join machines m on m.id = w.machine_id
   where w.downtime_start is not null;

-- Views sollen die Zugriffsregeln (RLS) der Tabellen respektieren und für
-- nicht angemeldete Zugriffe gesperrt sein.
do $$ begin
  alter view machines_due set (security_invoker = true);
  alter view v_downtime   set (security_invoker = true);
exception when others then raise notice 'security_invoker nicht verfügbar: %', sqlerrm;
end $$;
revoke all on machines_due, v_downtime from anon;

-- ---------- Checkliste kopieren und fällige Wartungen erzeugen --------
create or replace function copy_checklist(p_order uuid, p_machine uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into checklist_items (order_id, label, position)
    select p_order, label, position from machine_checklists where machine_id = p_machine order by position;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function generate_due_maintenance() returns int
language plpgsql security definer set search_path = public as $$
declare created int := 0; m record; neu uuid;
begin
  -- Verhindert Doppelanlage, wenn mehrere Geräte gleichzeitig prüfen
  perform pg_advisory_xact_lock(hashtext('generate_due_maintenance'));
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

-- Nur angemeldete Benutzer dürfen diese Funktionen aufrufen
revoke all on function copy_checklist(uuid, uuid) from public, anon;
revoke all on function generate_due_maintenance()  from public, anon;
grant execute on function copy_checklist(uuid, uuid) to authenticated;
grant execute on function generate_due_maintenance()  to authenticated;

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

-- API-Schema neu einlesen, damit neue Spalten sofort abfragbar sind
notify pgrst, 'reload schema';
