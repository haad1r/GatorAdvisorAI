-- The student's record now matches the engine's AcademicRecord
-- (lib/engines/schemas/record.ts): course attempts, exam credit, elective
-- credit and facts. lib/server/academic-record.ts turns these rows into an
-- AcademicRecord and validates it with the engine's own schema.
-- Run while coursework was empty in production, so no rows are converted.

-- coursework: one row per attempt, named as the engine names them.
-- `source` now says where the course was taken; how it got into the app moves
-- to `entered_via`. The old review status becomes `review_status`, and
-- `status` is the attempt's state (completed / in_progress).
alter table public.coursework drop constraint coursework_source_check;
alter table public.coursework rename column status to review_status;
alter table public.coursework rename constraint coursework_status_check to coursework_review_status_check;

alter table public.coursework
  add column entered_via text not null default 'manual' check (entered_via in ('import', 'manual')),
  add column status      text not null default 'completed' check (status in ('completed', 'in_progress')),
  add column institution text,
  alter column grade drop not null,
  alter column term drop not null;
alter table public.coursework alter column entered_via drop default, alter column status drop default;

alter table public.coursework
  add constraint coursework_source_check check (source in ('uf', 'transfer', 'dual_enrollment')),
  -- The engine's grade symbols. A transfer grade UF doesn't show (e.g. "T") is stored as null.
  add constraint coursework_grade_check check (grade in (
    'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'E',
    'WF', 'I', 'NG', 'S', 'U', 'W', 'H', 'I*', 'N*')),
  add constraint coursework_in_progress_has_no_grade check (status = 'completed' or grade is null),
  add constraint coursework_uf_has_term check (source <> 'uf' or term is not null),
  add constraint coursework_transfer_has_institution check (source = 'uf' or institution is not null);

comment on column public.coursework.original_label is
  'The import''s wording; for a transfer course, the code as the sending institution listed it';

-- Credit from AP, IB, AICE, CLEP...: what UF granted, as the degree audit shows it.
-- award_id names the catalog.exam_awards row it matches (no FK, so catalog
-- reloads can't block or cascade into student data).
create table public.exam_credits (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null references public.coursework_records (user_id) on delete cascade,
  award_id       text not null,
  score          numeric(5,1) not null,
  course_codes   text[] not null default '{}'
                 check (array_to_string(course_codes, ',') ~ '^([A-Z]{3}[0-9]{4}[A-Z]?(,[A-Z]{3}[0-9]{4}[A-Z]?)*)?$'),
  credits        numeric(4,1) not null check (credits >= 0),
  entered_via    text not null check (entered_via in ('import', 'manual')),
  review_status  text not null check (review_status in ('confirmed', 'needs-review')),
  original_label text,
  created_at     timestamptz not null default now()
);
create index on public.exam_credits (user_id);

-- Hours with no UF course equivalent (L000/U000/T000 placeholders and the like).
-- They count toward total credits and nothing else.
create table public.elective_credits (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null references public.coursework_records (user_id) on delete cascade,
  label          text not null check (label <> ''),
  credits        numeric(4,1) not null check (credits >= 0),
  source         text not null check (source in ('transfer', 'dual_enrollment', 'exam')),
  institution    text,
  entered_via    text not null check (entered_via in ('import', 'manual')),
  review_status  text not null check (review_status in ('confirmed', 'needs-review')),
  created_at     timestamptz not null default now()
);
create index on public.elective_credits (user_id);

alter table public.exam_credits enable row level security;
alter table public.elective_credits enable row level security;

-- Facts from the degree audit. Null means unknown, never "no".
alter table public.coursework_records
  add column has_florida_aa       boolean,
  add column language_proficiency boolean;


-- save_coursework now saves the whole record: attempts, exam credit, elective
-- credit and facts, in one transaction and only at the version the client
-- loaded (P0409 otherwise). Returns the new version.
drop function public.save_coursework(text, integer, jsonb);

create function public.save_coursework(
  p_user_id          text,
  p_expected_version integer,
  p_attempts         jsonb,
  p_exam_credits     jsonb,
  p_elective_credits jsonb,
  p_facts            jsonb
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  current_version integer;
begin
  insert into public.coursework_records (user_id, version) values (p_user_id, 0)
  on conflict (user_id) do nothing;

  -- Locks the record, so a concurrent save waits here and then sees the new version.
  select version into current_version
  from public.coursework_records
  where user_id = p_user_id
  for update;

  if current_version is distinct from p_expected_version then
    raise exception 'STALE_WRITE: expected version %, found %', p_expected_version, current_version
      using errcode = 'P0409';
  end if;

  delete from public.coursework where user_id = p_user_id;
  delete from public.exam_credits where user_id = p_user_id;
  delete from public.elective_credits where user_id = p_user_id;

  insert into public.coursework
    (user_id, course_code, grade, credits, term, source, institution, status, entered_via, review_status, original_label)
  select p_user_id, r.course_code, r.grade, r.credits, r.term, r.source, r.institution, r.status, r.entered_via, r.review_status, r.original_label
  from jsonb_to_recordset(coalesce(p_attempts, '[]'::jsonb)) as r(
    course_code text, grade text, credits numeric, term text, source text, institution text,
    status text, entered_via text, review_status text, original_label text);

  insert into public.exam_credits
    (user_id, award_id, score, course_codes, credits, entered_via, review_status, original_label)
  select p_user_id, r.award_id, r.score, coalesce(r.course_codes, '{}'), r.credits, r.entered_via, r.review_status, r.original_label
  from jsonb_to_recordset(coalesce(p_exam_credits, '[]'::jsonb)) as r(
    award_id text, score numeric, course_codes text[], credits numeric,
    entered_via text, review_status text, original_label text);

  insert into public.elective_credits
    (user_id, label, credits, source, institution, entered_via, review_status)
  select p_user_id, r.label, r.credits, r.source, r.institution, r.entered_via, r.review_status
  from jsonb_to_recordset(coalesce(p_elective_credits, '[]'::jsonb)) as r(
    label text, credits numeric, source text, institution text, entered_via text, review_status text);

  update public.coursework_records
  set version              = current_version + 1,
      has_florida_aa       = (p_facts ->> 'has_florida_aa')::boolean,
      language_proficiency = (p_facts ->> 'language_proficiency')::boolean
  where user_id = p_user_id;

  return current_version + 1;
end
$$;

-- Server only. Supabase grants new functions to the browser roles by default.
revoke execute on function public.save_coursework(text, integer, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_coursework(text, integer, jsonb, jsonb, jsonb, jsonb) to service_role;
