\set ON_ERROR_STOP 1
-- Behavior checks for the initial schema. Seeds two made-up students (no real
-- data) and fails loudly if the database allows something it should refuse.
-- See docs/database.md "Testing it locally".

-- Helper: run a statement and fail the check if it does NOT raise.
create or replace function pg_temp.must_fail(label text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'PASS  % (rejected: %)', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL  % was allowed', label;
end $$;

-- Two students.
insert into profiles (user_id, email, preferred_name, class_standing, program_id, catalog_year, entry_term, expected_graduation)
values ('user_A', 'a@ufl.edu', 'Ann', 'sophomore', 'uglas-csc_bs', '2025-2026', 'Fall 2025', 'Spring 2029'),
       ('user_B', 'b@ufl.edu', 'Ben', 'freshman',  'uglas-csc_bs', '2026-2027', 'Fall 2026', 'Spring 2030');
insert into coursework_records (user_id) values ('user_A'), ('user_B');
insert into coursework (user_id, course_code, grade, credits, term, source, status) values
  ('user_A', 'COP3502C', 'A', 4, 'Fall 2025', 'transcript', 'confirmed'),
  ('user_A', 'PSY2012', 'CR', 3, 'Fall 2025', 'exam', 'confirmed'),
  ('user_A', 'MUS1010', 'S', 0, 'Fall 2025', 'transcript', 'confirmed');
insert into schedules (id, user_id, term, is_primary) values
  ('00000000-0000-0000-0000-00000000000a', 'user_A', '2268', true),
  ('00000000-0000-0000-0000-00000000000b', 'user_B', '2268', true);
insert into schedule_sections (id, schedule_id, user_id, course_code, class_number, section) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'user_A', 'COT3100', '11529', '5678');
insert into schedule_sections (schedule_id, user_id, course_code) values
  ('00000000-0000-0000-0000-00000000000a', 'user_A', 'MAC2311');
insert into schedule_meetings (schedule_section_id, user_id, kind, day, start_time, end_time, location) values
  ('00000000-0000-0000-0000-0000000000a1', 'user_A', 'lecture', 'MON', '10:40', '11:30', 'CSE A101');
insert into chat_conversations (id, user_id) values ('00000000-0000-0000-0000-0000000000c1', 'user_A');
insert into chat_messages (conversation_id, user_id, role, content) values ('00000000-0000-0000-0000-0000000000c1', 'user_A', 'user', 'hi');
insert into survey_submissions (user_id, survey_version, interest_list_version, answers) values ('user_A', 'survey_v1', 'interests_v1', '[]');
insert into recommendation_events (user_id, course_code, event, scoring_version) values ('user_A', 'COP3530', 'liked', 'scoring_v1');
insert into plans (id, user_id, program_id, catalog_year, target_graduation, record_version) values
  ('00000000-0000-0000-0000-0000000000f1', 'user_A', 'uglas-csc_bs', '2025-2026', 'Spring 2029', 1);
\echo seeded

-- Ownership: B can't hang rows off A's schedule / conversation / plan.
select pg_temp.must_fail('B adds a section to A''s schedule',
  $$insert into schedule_sections (schedule_id, user_id, course_code) values ('00000000-0000-0000-0000-00000000000a', 'user_B', 'MAC2313')$$);
select pg_temp.must_fail('B adds a meeting to A''s section',
  $$insert into schedule_meetings (schedule_section_id, user_id, kind) values ('00000000-0000-0000-0000-0000000000a1', 'user_B', 'lab')$$);
select pg_temp.must_fail('B posts into A''s conversation',
  $$insert into chat_messages (conversation_id, user_id, role, content) values ('00000000-0000-0000-0000-0000000000c1', 'user_B', 'user', 'x')$$);
select pg_temp.must_fail('B adds a course to A''s plan',
  $$insert into plan_courses (plan_id, user_id, term, course_code) values ('00000000-0000-0000-0000-0000000000f1', 'user_B', 'Fall 2027', 'COP3530')$$);

-- Bad values.
select pg_temp.must_fail('course code with a space', $$insert into coursework (user_id, course_code, grade, credits, term, source, status) values ('user_A', 'COP 3530', 'A', 3, 'x', 'manual', 'confirmed')$$);
select pg_temp.must_fail('negative credits', $$insert into coursework (user_id, course_code, grade, credits, term, source, status) values ('user_A', 'COP3530', 'A', -1, 'x', 'manual', 'confirmed')$$);
select pg_temp.must_fail('same course twice with no section', $$insert into schedule_sections (schedule_id, user_id, course_code) values ('00000000-0000-0000-0000-00000000000a', 'user_A', 'MAC2311')$$);
select pg_temp.must_fail('same class number twice in a schedule', $$insert into schedule_sections (schedule_id, user_id, course_code, class_number, section) values ('00000000-0000-0000-0000-00000000000a', 'user_A', 'COT3100', '11529', '9999')$$);
select pg_temp.must_fail('unknown source', $$insert into coursework (user_id, course_code, grade, credits, term, source, status) values ('user_A', 'COP3530', 'A', 3, 'x', 'magic', 'confirmed')$$);
select pg_temp.must_fail('two primary schedules in one term', $$insert into schedules (user_id, term, is_primary) values ('user_A', '2268', true)$$);
select pg_temp.must_fail('meeting ends before it starts', $$insert into schedule_meetings (schedule_section_id, user_id, kind, day, start_time, end_time) values ('00000000-0000-0000-0000-0000000000a1', 'user_A', 'lab', 'TUE', '11:00', '10:00')$$);
select pg_temp.must_fail('meeting with a day but no times', $$insert into schedule_meetings (schedule_section_id, user_id, kind, day) values ('00000000-0000-0000-0000-0000000000a1', 'user_A', 'lab', 'TUE')$$);
select pg_temp.must_fail('coursework for a student with no profile', $$insert into coursework (user_id, course_code, grade, credits, term, source, status) values ('user_GONE', 'COP3530', 'A', 3, 'x', 'manual', 'confirmed')$$);

-- The server (service_role) can read and load catalog, and reloading a
-- milestone updates it in place instead of adding a copy.
set role service_role;
do $$ declare n int;
begin
  insert into catalog.programs (id, name, kind, status, catalog_year, source_url, fetched_at)
  values ('test-prog', 'Test Program', 'major', 'published', '2026-2027', 'https://catalog.ufl.edu', now());
  for i in 1..2 loop
    insert into catalog.tracking_milestones (program_id, semester, position, kind, raw_text)
    values ('test-prog', 1, 1, 'note', 'reload ' || i)
    on conflict (program_id, semester, position) do update set raw_text = excluded.raw_text;
  end loop;
  select count(*) into n from catalog.tracking_milestones where program_id = 'test-prog';
  if n <> 1 then raise exception 'FAIL reloading a milestone left % rows', n; end if;
  perform count(*) from catalog.courses;
  raise notice 'PASS  service_role reads and loads catalog; a milestone reload upserts';
end $$;
reset role;
select pg_temp.must_fail('two milestones in the same position', $$insert into catalog.tracking_milestones (program_id, semester, position, kind, raw_text) values ('test-prog', 1, 1, 'note', 'copy')$$);
delete from catalog.programs where id = 'test-prog';

-- updated_at moves on update.
do $$ declare before timestamptz; after timestamptz;
begin
  select updated_at into before from profiles where user_id = 'user_A';
  perform pg_sleep(0.01);
  update profiles set preferred_name = 'Annie' where user_id = 'user_A';
  select updated_at into after from profiles where user_id = 'user_A';
  if after <= before then raise exception 'FAIL updated_at did not move'; end if;
  raise notice 'PASS  updated_at moves on update';
end $$;

-- Deleting a profile removes every private row for that student, and only theirs.
insert into account_deletions (user_id) values ('user_A');
delete from profiles where user_id = 'user_A';
do $$ declare leftover int; b_rows int;
begin
  select (select count(*) from coursework_records where user_id='user_A') + (select count(*) from coursework where user_id='user_A')
       + (select count(*) from survey_submissions where user_id='user_A') + (select count(*) from schedules where user_id='user_A')
       + (select count(*) from schedule_sections where user_id='user_A') + (select count(*) from schedule_meetings where user_id='user_A')
       + (select count(*) from plans where user_id='user_A') + (select count(*) from chat_conversations where user_id='user_A')
       + (select count(*) from chat_messages where user_id='user_A') + (select count(*) from recommendation_events where user_id='user_A')
    into leftover;
  if leftover <> 0 then raise exception 'FAIL % rows survived deleting user_A', leftover; end if;
  select count(*) into b_rows from schedules where user_id = 'user_B';
  if b_rows <> 1 then raise exception 'FAIL user_B lost data'; end if;
  if not exists (select 1 from account_deletions where user_id = 'user_A') then raise exception 'FAIL deletion log was removed'; end if;
  raise notice 'PASS  deleting a profile cascades to all 10 private tables, keeps user_B, keeps the deletion log';
end $$;

-- A queued job can't recreate data for a deleted student.
select pg_temp.must_fail('recreating data after deletion', $$insert into survey_submissions (user_id, survey_version, interest_list_version, answers) values ('user_A', 'survey_v1', 'interests_v1', '[]')$$);

-- Milestones: GPA rules (kind gpa) carry gpa_min and gpa_scope; nothing else does.
insert into catalog.programs (id, name, kind, status, catalog_year, source_url, fetched_at)
values ('test-gpa_bs', 'Test', 'major', 'published', '2026-2027', 'https://example.test', now());
insert into catalog.tracking_milestones (program_id, semester, position, kind, raw_text, gpa_min, gpa_scope)
values ('test-gpa_bs', 1, 1, 'gpa', '2.5 UF GPA required', 2.5, 'uf');
insert into catalog.tracking_milestones (program_id, semester, position, kind, slots, raw_text, min_grade)
values ('test-gpa_bs', 1, 2, 'courses', '[[["mac2311"]]]', 'MAC 2311 with a C', 'C');
\echo PASS  a gpa milestone and a course milestone with a minimum grade load
select pg_temp.must_fail('a gpa milestone with no gpa_min', $$insert into catalog.tracking_milestones (program_id, semester, position, kind, raw_text, gpa_scope) values ('test-gpa_bs', 2, 1, 'gpa', 'x', 'uf')$$);
select pg_temp.must_fail('a course milestone with a gpa_min', $$insert into catalog.tracking_milestones (program_id, semester, position, kind, raw_text, gpa_min, gpa_scope) values ('test-gpa_bs', 2, 1, 'courses', 'x', 2.0, 'uf')$$);
select pg_temp.must_fail('an unknown gpa scope', $$insert into catalog.tracking_milestones (program_id, semester, position, kind, raw_text, gpa_min, gpa_scope) values ('test-gpa_bs', 2, 1, 'gpa', 'x', 2.0, 'dept')$$);
select pg_temp.must_fail('a gpa above 4', $$insert into catalog.tracking_milestones (program_id, semester, position, kind, raw_text, gpa_min, gpa_scope) values ('test-gpa_bs', 2, 1, 'gpa', 'x', 4.5, 'uf')$$);
delete from catalog.programs where id = 'test-gpa_bs';

-- Freshness: terms record when their schedule data was fetched.
select fetched_at from catalog.terms limit 0;
\echo PASS  catalog.terms has fetched_at

-- save_coursework: replaces the whole list, bumps the version, refuses stale or partial saves.
do $$ declare v int; n int;
begin
  v := public.save_coursework('user_B', 1, '[
    {"course_code":"MAC2311","grade":"A","credits":4,"term":"Fall 2026","source":"transcript","status":"confirmed"},
    {"course_code":"ENC1101","grade":"B+","credits":3,"term":"Fall 2026","source":"manual","status":"needs-review","original_label":"ENC 1101 Expos & Arg Writing"}]');
  select count(*) into n from coursework where user_id = 'user_B';
  if v <> 2 or n <> 2 then raise exception 'FAIL first save returned version % with % rows', v, n; end if;
  v := public.save_coursework('user_B', 2, '[{"course_code":"MAC2311","grade":"A","credits":4,"term":"Fall 2026","source":"transcript","status":"confirmed"}]');
  select count(*) into n from coursework where user_id = 'user_B';
  if v <> 3 or n <> 1 then raise exception 'FAIL second save returned version % with % rows', v, n; end if;
  raise notice 'PASS  save_coursework replaces the list and bumps the version';
end $$;

do $$ begin
  perform public.save_coursework('user_B', 2, '[]');
  raise exception 'FAIL a save with an old version went through';
exception when sqlstate 'P0409' then
  raise notice 'PASS  a save with an old version raises P0409 (STALE_WRITE)';
end $$;
select pg_temp.must_fail('a save with no version', $$select public.save_coursework('user_B', null, '[]')$$);
select pg_temp.must_fail('a save with one bad row',
  $$select public.save_coursework('user_B', 3, '[{"course_code":"COP3530","grade":"A","credits":3,"term":"x","source":"manual","status":"confirmed"},{"course_code":"COP 3530","grade":"A","credits":3,"term":"x","source":"manual","status":"confirmed"}]')$$);
select pg_temp.must_fail('a save for someone with no profile', $$select public.save_coursework('user_nobody', 0, '[]')$$);

do $$ declare v int; n int;
begin
  select version into v from coursework_records where user_id = 'user_B';
  select count(*) into n from coursework where user_id = 'user_B';
  if v <> 3 or n <> 1 then raise exception 'FAIL refused saves changed the record: version %, % rows', v, n; end if;
  raise notice 'PASS  refused saves leave the list and version untouched';
end $$;

insert into profiles (user_id, email, preferred_name, class_standing, program_id, catalog_year, entry_term, expected_graduation)
values ('user_C', 'c@ufl.edu', 'Cam', 'junior', 'uglas-csc_bs', '2024-2025', 'Fall 2024', 'Spring 2028');
do $$ begin
  if public.save_coursework('user_C', 0, '[]') <> 1 then raise exception 'FAIL first save for a new student'; end if;
  raise notice 'PASS  a new student starts at version 0 and their first save makes version 1';
end $$;

grant usage on schema public to anon, authenticated;
set role anon;
do $$ begin
  perform public.save_coursework('user_B', 3, '[]');
  raise exception 'FAIL the anon role can call save_coursework';
exception when insufficient_privilege then
  raise notice 'PASS  the anon role can''t call save_coursework';
end $$;
set role authenticated;
do $$ begin
  perform public.save_coursework('user_B', 3, '[]');
  raise exception 'FAIL the authenticated role can call save_coursework';
exception when insufficient_privilege then
  raise notice 'PASS  the authenticated role can''t call save_coursework';
end $$;
reset role;

-- RLS: a browser role with no policies sees nothing.
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon_test') then create role anon_test nologin; end if; end $$;
grant usage on schema public, catalog to anon_test;
grant select on all tables in schema public, catalog to anon_test;
set role anon_test;
do $$ declare n int;
begin
  select count(*) into n from profiles;
  if n <> 0 then raise exception 'FAIL anon role can read % profiles', n; end if;
  raise notice 'PASS  browser role reads 0 profiles even with SELECT granted (RLS)';
end $$;
reset role;
-- Roles are server-wide, so clean up to keep the file rerunnable.
drop owned by anon_test;
drop role anon_test;
\echo ALL CHECKS PASSED
