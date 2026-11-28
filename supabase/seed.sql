-- Development seed: the same made-up student the app's mock data uses
-- (lib/mocks/fixtures.ts), so a screen shows the same thing against the real
-- database as it does on mocks. Never run this against production.
--
-- Replace the user id with your Clerk test user's id (Clerk dashboard →
-- Users → copy "user_..."), then run after the migration:
--   psql "$DATABASE_URL" -f supabase/seed.sql
--
-- Course codes, credits and section numbers are real UF data; the person,
-- grades and meeting times are not.

begin;

\set student '''user_dev_student'''

insert into profiles (user_id, email, email_verified_at, preferred_name, class_standing, program_id, catalog_year, entry_term, expected_graduation)
values (:student, 'test.student@ufl.edu', now(), 'Test Student', 'sophomore', 'uglas-csc_bs', '2025-2026', 'Fall 2025', 'Spring 2029');

-- 22 class credits + 9 AP credits = 31 earned.
insert into coursework_records (user_id, version) values (:student, 1);
insert into coursework (user_id, course_code, grade, credits, term, source, status, entered_via, review_status) values
  (:student, 'COP3502C', 'A',  4, 'Fall 2025',   'uf', 'completed', 'import', 'confirmed'),
  (:student, 'MAC2311',  'B+', 4, 'Fall 2025',   'uf', 'completed', 'import', 'confirmed'),
  (:student, 'ENC1101',  'A-', 3, 'Fall 2025',   'uf', 'completed', 'import', 'confirmed'),
  (:student, 'COP3503C', 'B',  4, 'Spring 2026', 'uf', 'completed', 'import', 'needs-review'),
  (:student, 'MAC2312',  'S',  4, 'Spring 2026', 'uf', 'completed', 'import', 'needs-review'),
  (:student, 'CHM2045',  'B-', 3, 'Spring 2026', 'uf', 'completed', 'manual', 'confirmed');
insert into exam_credits (user_id, award_id, score, course_codes, credits, entered_via, review_status) values
  (:student, 'ap-psychology-3-5',            4, '{PSY2012}',         3, 'import', 'confirmed'),
  (:student, 'ap-united-states-history-4-5', 5, '{AMH2010,AMH2020}', 6, 'import', 'confirmed');

-- This term (Fall 2026): real section numbers, made-up times and rooms.
insert into schedules (id, user_id, term, name, is_primary)
values ('5eed0000-0000-0000-0000-000000000001', :student, '2268', 'Fall 2026', true);

insert into schedule_sections (id, schedule_id, user_id, course_code, class_number, section) values
  ('5eed0000-0000-0000-0000-0000000000a1', '5eed0000-0000-0000-0000-000000000001', :student, 'PHY2048',  '14332', '2468'),
  ('5eed0000-0000-0000-0000-0000000000a2', '5eed0000-0000-0000-0000-000000000001', :student, 'PHY2048L', '14384', '2268'),
  ('5eed0000-0000-0000-0000-0000000000a3', '5eed0000-0000-0000-0000-000000000001', :student, 'COT3100',  '11529', '1096'),
  ('5eed0000-0000-0000-0000-0000000000a4', '5eed0000-0000-0000-0000-000000000001', :student, 'ENC2210',  '11792', '4B48'),
  ('5eed0000-0000-0000-0000-0000000000a5', '5eed0000-0000-0000-0000-000000000001', :student, 'PHI1680',  '26559', '1003');

insert into schedule_meetings (schedule_section_id, user_id, kind, day, start_time, end_time, location, online) values
  ('5eed0000-0000-0000-0000-0000000000a1', :student, 'lecture',    'MON', '09:35', '10:25', 'NPB 1001', false),
  ('5eed0000-0000-0000-0000-0000000000a1', :student, 'lecture',    'WED', '09:35', '10:25', 'NPB 1001', false),
  ('5eed0000-0000-0000-0000-0000000000a1', :student, 'lecture',    'FRI', '09:35', '10:25', 'NPB 1001', false),
  ('5eed0000-0000-0000-0000-0000000000a1', :student, 'discussion', 'THU', '08:30', '09:20', 'NPB 1101', false),
  ('5eed0000-0000-0000-0000-0000000000a3', :student, 'lecture',    'MON', '10:40', '11:30', 'CSE A101', false),
  ('5eed0000-0000-0000-0000-0000000000a3', :student, 'lecture',    'WED', '10:40', '11:30', 'CSE A101', false),
  ('5eed0000-0000-0000-0000-0000000000a3', :student, 'lecture',    'FRI', '10:40', '11:30', 'CSE A101', false),
  ('5eed0000-0000-0000-0000-0000000000a3', :student, 'discussion', 'TUE', '12:50', '13:40', 'CSE E115', false),
  ('5eed0000-0000-0000-0000-0000000000a5', :student, 'lecture',    'MON', '12:50', '13:40', 'FLI 50',   false),
  ('5eed0000-0000-0000-0000-0000000000a5', :student, 'lecture',    'WED', '12:50', '13:40', 'FLI 50',   false),
  ('5eed0000-0000-0000-0000-0000000000a5', :student, 'discussion', 'FRI', '12:50', '13:40', 'FLO 100',  false),
  ('5eed0000-0000-0000-0000-0000000000a2', :student, 'lab',        'WED', '15:00', '16:55', 'NPB B110', false),
  -- Every Fall 2026 ENC 2210 section is fully online: no time, not on the calendar.
  ('5eed0000-0000-0000-0000-0000000000a4', :student, 'lecture',    null,  null,    null,    null,       true);

insert into schedule_meetings (schedule_section_id, user_id, kind, day, start_time, end_time, exam_date, location, online)
values ('5eed0000-0000-0000-0000-0000000000a1', :student, 'exam', 'THU', '20:20', '22:10', '2026-11-19', 'CAR 100', false);

-- No survey, plans, chats or recommendation events yet, same as the mocks.

commit;
