-- Beispielstruktur. Nach schema.sql ausführen.
insert into departments (name) values ('Fertigung'), ('Abfüllung'), ('Logistik'), ('Verwaltung');

insert into rooms (department_id, name)
select id, r from departments d
cross join lateral (values ('Halle 1'), ('Halle 2')) v(r)
where d.name in ('Fertigung','Abfüllung');

insert into rooms (department_id, name)
select id, 'Lagerhalle' from departments where name = 'Logistik';
insert into rooms (department_id, name)
select id, r from departments d cross join lateral (values ('Küche'), ('Büro Nord')) v(r)
where d.name = 'Verwaltung';

insert into machines (room_id, name, manufacturer, cycle, last_maintenance, spare_parts)
select r.id, m.name, m.herst, m.zyk::cycle_kind, current_date - (m.tage || ' days')::interval, m.teile
from rooms r
join departments d on d.id = r.department_id
join (values
  ('Spritzgussmaschine SG-1','Arburg','monatlich', 40, array['Heizband 230V','Dichtsatz Schnecke']),
  ('CNC-Fräse 01','DMG Mori','quartalsweise', 20, array['Kühlmittelpumpe','Spindellager'])
) as m(name,herst,zyk,tage,teile) on true
where d.name = 'Fertigung' and r.name = 'Halle 1';

insert into machine_checklists (machine_id, label, position)
select m.id, v.l, v.p from machines m
join (values ('Sichtprüfung auf Leckagen',0),('Schmierstellen abschmieren',1),
             ('Filter prüfen und tauschen',2),('Not-Halt geprüft',3),('Probelauf durchgeführt',4)) v(l,p) on true;
