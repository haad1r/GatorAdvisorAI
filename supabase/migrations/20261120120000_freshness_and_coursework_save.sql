-- When each term's schedule (SOC) data was fetched, for /api/meta/freshness.
alter table catalog.terms add column fetched_at timestamptz;

-- Replaces a student's whole course list in one transaction, and only if the
-- record is still at the version the client loaded; otherwise it raises
-- SQLSTATE P0409, which the route turns into 409 STALE_WRITE. Returns the new
-- version. A student with no record yet is at version 0.
create function public.save_coursework(p_user_id text, p_expected_version integer, p_rows jsonb)
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

  insert into public.coursework (user_id, course_code, grade, credits, term, source, status, original_label)
  select p_user_id, r.course_code, r.grade, r.credits, r.term, r.source, r.status, r.original_label
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
    as r(course_code text, grade text, credits numeric, term text, source text, status text, original_label text);

  update public.coursework_records set version = current_version + 1 where user_id = p_user_id;
  return current_version + 1;
end
$$;

-- Server only. Supabase grants new functions to the browser roles by default.
revoke execute on function public.save_coursework(text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_coursework(text, integer, jsonb) to service_role;
