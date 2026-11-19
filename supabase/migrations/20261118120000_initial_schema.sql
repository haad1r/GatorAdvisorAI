-- GatorAdvisor initial schema (issue #6 step 4-5, #8 catalog persistence).
--
-- Two schemas:
--   catalog  Public UF data loaded from data/ (Shaun's scrape, RMP import).
--            Replaced on each reload; never holds anything about a student.
--   public   Private student data. Every row belongs to one Clerk user and is
--            deleted with them (ON DELETE CASCADE from profiles).
--
-- Child tables (schedule sections, plan courses, chat messages) repeat the
-- owner's user_id and reference the parent by (id, user_id), so the database
-- itself refuses a row that points at another student's parent.
--
-- Access: the browser never talks to this database. Next.js route handlers
-- verify the Clerk session, then query with the service role and filter by
-- that user's id (#6 step 3, "authenticated backend endpoints"). RLS is
-- enabled with no policies, so a leaked anon key can read nothing.
--
-- Explained table by table in docs/database.md.

create schema if not exists catalog;

-- updated_at bookkeeping, shared by every table that has the column.
create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- =====================================================================
-- catalog: public UF data (loaded by step [11], refreshed by re-running it)
-- =====================================================================

-- data/catalog/courses.csv: one row per catalog course ("cop3502c").
create table catalog.courses (
  id               text primary key,           -- "cop3502c": lowercase, no space
  code             text not null,              -- "COP 3502C" as UF prints it
  name             text not null,
  credits_min      numeric(4,1),
  credits_max      numeric(4,1),
  description      text,
  grading          text,
  gen_ed           text[] not null default '{}',
  quest            text,
  writing_words    integer,
  other_attributes text[] not null default '{}',
  dept_slug        text,
  catalog_year     text not null,
  source_url       text not null,
  fetched_at       timestamptz not null
);

-- data/catalog/requisites.csv: parsed prerequisite / corequisite trees.
create table catalog.requisites (
  course_id    text not null references catalog.courses (id) on delete cascade,
  kind         text not null check (kind in ('prereq', 'coreq')),
  status       text not null,                  -- complete / partial / unparsed
  tree         jsonb,
  mentions     text[] not null default '{}',
  raw_text     text not null,
  catalog_year text not null,
  source_url   text not null,
  fetched_at   timestamptz not null,
  primary key (course_id, kind)
);

-- data/programs/programs.csv: majors, minors, certificates.
create table catalog.programs (
  id           text primary key,               -- "uglas-csc_bs"
  name         text not null,
  kind         text not null,                  -- major / minor / certificate
  degree       text,
  college_slug text,
  status       text not null,                  -- published / needs review
  confidence   numeric(4,3),
  catalog_year text not null,
  source_url   text not null,
  fetched_at   timestamptz not null
);

-- data/programs/requirements.csv: a program's requirement groups.
create table catalog.requirement_groups (
  program_id            text not null references catalog.programs (id) on delete cascade,
  group_key             text not null,
  name                  text not null,
  rtype                 text not null,         -- required_list / choose_credits / ...
  logic                 jsonb not null,
  eligible_course_ids   text[] not null default '{}',
  required_credits      numeric(5,1),
  required_course_count integer,
  sort_order            integer not null,
  section               text not null,         -- major / gened / ...
  primary key (program_id, group_key)
);

-- data/programs/milestones.csv: Critical Tracking by semester. A semester
-- can repeat a kind and even a row's text, so the reload key is the row's
-- position within its program and semester, in CSV order.
create table catalog.tracking_milestones (
  id         bigint generated always as identity primary key,
  program_id text not null references catalog.programs (id) on delete cascade,
  semester   integer not null,
  position   integer not null,
  kind       text not null check (kind in ('courses', 'count', 'note')),
  slots      jsonb,
  count      integer,
  pool       jsonb,
  raw_text   text not null,
  unique (program_id, semester, position)
);

-- data/programs/plans.csv: UF's model semester plan per program.
create table catalog.model_plan_courses (
  program_id           text not null references catalog.programs (id) on delete cascade,
  semester_index       integer not null,
  position             integer not null,
  course_id            text,
  placeholder          text,
  credits              numeric(4,1),
  is_critical_tracking boolean not null default false,
  is_summer            boolean not null default false,
  alt_group            text,
  alt_option           text,
  primary key (program_id, semester_index, position)
);

-- data/soc/terms.csv: which terms the schedule data covers.
create table catalog.terms (
  term     text primary key,                   -- "2271" (Spring 2027)
  name     text not null,
  closed   boolean not null,
  complete boolean not null
);

-- data/soc/sections/<term>.csv: every section offered in a term.
create table catalog.sections (
  term         text not null references catalog.terms (term) on delete cascade,
  class_number text not null,
  course_id    text not null,                  -- may be missing from catalog.courses
  section      text not null,
  credits_min  numeric(4,1),
  credits_max  numeric(4,1),
  career       text,
  delivery     text,
  instructors  text[] not null default '{}',
  gen_ed       text[] not null default '{}',
  quest        text,
  topic        text,
  dept_name    text,
  primary key (term, class_number)
);
create index on catalog.sections (course_id, term);

-- data/exam_credit/awards.csv: AP / IB / CLEP / ... score -> UF credit.
create table catalog.exam_awards (
  id           text primary key,               -- "ap-psychology-3-5"
  family       text not null,                  -- AP, IB, ...
  exam         text not null,
  min_score    numeric(5,1),
  max_score    numeric(5,1),
  course_ids   text[] not null default '{}',
  credits      numeric(4,1),
  gen_ed       text[] not null default '{}',
  award_text   text not null,
  catalog_year text not null,
  source_url   text not null,
  fetched_at   timestamptz not null
);

-- data/rmp/professors.csv: RateMyProfessors summary numbers (no review text).
create table catalog.professor_ratings (
  rmp_id           integer primary key,
  first_name       text not null,
  last_name        text not null,
  department       text,
  quality          numeric(2,1),               -- 1-5, null = no data
  difficulty       numeric(2,1),
  would_take_again numeric(5,2),               -- 0-100
  num_ratings      integer not null default 0,
  fetched_at       timestamptz not null
);

-- data/rmp/instructor_ratings.csv: SOC instructor name -> RMP profile.
create table catalog.instructor_matches (
  instructor_name text primary key,            -- exactly as SOC prints it
  rmp_id          integer references catalog.professor_ratings (rmp_id) on delete set null,
  match           text not null                -- exact / nickname / override / none / ...
);


-- =====================================================================
-- public: private student data
-- =====================================================================

-- One row per student, keyed by their Clerk user id. Every other private
-- table references this, so deleting the profile deletes everything.
create table public.profiles (
  user_id             text primary key,        -- Clerk "user_..."
  email               text not null,
  email_verified_at   timestamptz,             -- set when Clerk confirms an @ufl.edu address
  preferred_name      text not null,
  class_standing      text not null check (class_standing in ('freshman', 'sophomore', 'junior', 'senior')),
  program_id          text not null,           -- catalog.programs.id; no FK so catalog reloads can't block or cascade
  catalog_year        text not null,           -- "2025-2026": decides which requirements apply
  entry_term          text not null,           -- "Fall 2025": first UF term, anchors tracking semesters
  expected_graduation text not null,           -- "Spring 2029"
  version             integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- The student's course record as a whole. The version goes up on every
-- save; a save that sends an older version is rejected (409 STALE_WRITE).
-- That also makes a double-clicked Save harmless: the second request still
-- carries the old version and fails instead of counting credits twice.
create table public.coursework_records (
  user_id    text primary key references public.profiles (user_id) on delete cascade,
  version    integer not null default 1,
  updated_at timestamptz not null default now()
);
create trigger coursework_records_touch before update on public.coursework_records
  for each row execute function public.touch_updated_at();

-- One row per attempt: a retaken course is two rows with different terms.
create table public.coursework (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null references public.coursework_records (user_id) on delete cascade,
  course_code    text not null check (course_code ~ '^[A-Z]{3}[0-9]{4}[A-Z]?$'),
  grade          text not null,
  credits        numeric(4,1) not null check (credits >= 0),  -- 0 for recital attendance, ROTC labs, some research
  term           text not null,
  source         text not null check (source in ('transcript', 'manual', 'exam', 'transfer')),
  status         text not null check (status in ('confirmed', 'needs-review')),
  original_label text,                         -- the transcript's wording, kept for review
  created_at     timestamptz not null default now()
);
create index on public.coursework (user_id);

-- Interest survey answers. Kept as history; the newest is the current one.
create table public.survey_submissions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               text not null references public.profiles (user_id) on delete cascade,
  survey_version        text not null,         -- "survey_v1"
  interest_list_version text not null,         -- "interests_v1"
  answers               jsonb not null,        -- SurveyAnswer[] from lib/api/types.ts
  submitted_at          timestamptz not null default now()
);
create index on public.survey_submissions (user_id, submitted_at desc);

-- Saved weekly schedules (several per term so students can compare).
create table public.schedules (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null references public.profiles (user_id) on delete cascade,
  term       text not null,                    -- "2271"
  name       text not null default 'My schedule',
  is_primary boolean not null default false,
  version    integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.schedules (user_id, term);
alter table public.schedules add unique (id, user_id);
-- At most one primary schedule per student per term.
create unique index schedules_one_primary on public.schedules (user_id, term) where is_primary;
create trigger schedules_touch before update on public.schedules
  for each row execute function public.touch_updated_at();

create table public.schedule_sections (
  id           uuid primary key default gen_random_uuid(),
  schedule_id  uuid not null,
  user_id      text not null references public.profiles (user_id) on delete cascade,
  course_code  text not null,
  class_number text,                           -- catalog.sections.class_number when known
  section      text,
  -- nulls not distinct: a course with no section yet can't be added twice.
  unique nulls not distinct (schedule_id, course_code, section),
  unique (id, user_id),
  -- The section must belong to a schedule owned by the same student.
  foreign key (schedule_id, user_id) references public.schedules (id, user_id) on delete cascade
);
create unique index schedule_sections_one_class_number on public.schedule_sections (schedule_id, class_number)
  where class_number is not null;

-- Meeting times. UF's public data has none, so students enter them.
create table public.schedule_meetings (
  id                  uuid primary key default gen_random_uuid(),
  schedule_section_id uuid not null,
  user_id             text not null references public.profiles (user_id) on delete cascade,
  kind                text not null check (kind in ('lecture', 'lab', 'discussion', 'exam')),
  day                 text check (day in ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN')),
  start_time          time,
  end_time            time,
  exam_date           date,                    -- only for kind = 'exam'
  location            text,
  online              boolean not null default false,
  check ((day is null) = (start_time is null) and (start_time is null) = (end_time is null)),
  check (end_time is null or end_time > start_time),
  foreign key (schedule_section_id, user_id) references public.schedule_sections (id, user_id) on delete cascade
);

-- Saved semester plans. What-if results are never stored here (#8).
create table public.plans (
  id                uuid primary key default gen_random_uuid(),
  user_id           text not null references public.profiles (user_id) on delete cascade,
  name              text not null default 'My plan',
  program_id        text not null,
  catalog_year      text not null,
  target_graduation text not null,
  max_credits       integer not null default 15 check (max_credits between 1 and 24),
  record_version    integer not null,          -- coursework version the plan was built on
  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on public.plans (user_id);
alter table public.plans add unique (id, user_id);
create trigger plans_touch before update on public.plans
  for each row execute function public.touch_updated_at();

create table public.plan_courses (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null,
  user_id     text not null references public.profiles (user_id) on delete cascade,
  term        text not null,                   -- "Fall 2027"
  course_code text not null,
  locked      boolean not null default false,    -- locks survive regeneration (#8)
  reason      text,                            -- which requirement it fills
  unique (plan_id, term, course_code),
  foreign key (plan_id, user_id) references public.plans (id, user_id) on delete cascade
);

-- AI advisor conversations (#10). Only the table lives here; the AI team
-- owns what goes in it.
create table public.chat_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null references public.profiles (user_id) on delete cascade,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.chat_conversations (user_id, updated_at desc);
alter table public.chat_conversations add unique (id, user_id);
create trigger chat_conversations_touch before update on public.chat_conversations
  for each row execute function public.touch_updated_at();

create table public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_id         text not null references public.profiles (user_id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'tool')),
  content         text not null,
  sources         jsonb,                       -- citations shown as chips (#21)
  created_at      timestamptz not null default now(),
  foreign key (conversation_id, user_id) references public.chat_conversations (id, user_id) on delete cascade
);
-- Loading the latest N messages of a conversation stays fast as chats grow.
create index on public.chat_messages (conversation_id, created_at desc);

-- What the student did with a recommendation (#11 learning-ready feedback).
create table public.recommendation_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null references public.profiles (user_id) on delete cascade,
  course_code     text not null,
  event           text not null check (event in ('shown', 'liked', 'disliked', 'not_interested', 'added_to_plan')),
  scoring_version text not null,               -- "scoring_v1"
  record_version  integer,
  created_at      timestamptz not null default now()
);
create index on public.recommendation_events (user_id, created_at desc);

-- Account deletion bookkeeping (#6 step 8). No foreign key on purpose: this
-- row must survive the profile being deleted so a half-finished deletion
-- (e.g. database done, Clerk call failed) can be retried and never reported
-- as complete early.
create table public.account_deletions (
  user_id      text primary key,
  requested_at timestamptz not null default now(),
  database_done_at timestamptz,
  clerk_done_at    timestamptz,
  attempts     integer not null default 0,
  last_error   text
);


-- =====================================================================
-- Row Level Security: deny everything to browser roles
-- =====================================================================
-- The service role (used only on the server) bypasses RLS. anon and
-- authenticated get no policies, so they can't read or write any row even
-- with a leaked key. If the browser ever needs direct access, add policies
-- that map the Clerk user id explicitly (auth.uid() is NOT a Clerk id).

do $$
declare t record;
begin
  for t in select schemaname, tablename from pg_tables where schemaname in ('public', 'catalog') loop
    execute format('alter table %I.%I enable row level security', t.schemaname, t.tablename);
  end loop;
end $$;


-- =====================================================================
-- Catalog access for the server
-- =====================================================================
-- Supabase sets up its roles' access to the public schema only, so the
-- server (service_role) needs explicit grants to read and load catalog.
-- anon and authenticated get none.

grant usage on schema catalog to service_role;
grant all on all tables in schema catalog to service_role;
grant all on all sequences in schema catalog to service_role;
alter default privileges in schema catalog grant all on tables to service_role;
alter default privileges in schema catalog grant all on sequences to service_role;
