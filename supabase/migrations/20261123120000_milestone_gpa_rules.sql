-- Critical Tracking GPA rules and minimum grades, added to data/programs/milestones.csv
-- in #30. Mirrors the engine's Milestone schema (lib/engines/schemas/catalog.ts):
-- a "gpa" milestone, and only a "gpa" milestone, has gpa_min and gpa_scope.
alter table catalog.tracking_milestones drop constraint tracking_milestones_kind_check;

alter table catalog.tracking_milestones
  add constraint tracking_milestones_kind_check check (kind in ('courses', 'count', 'note', 'gpa')),
  add column min_grade text,
  add column gpa_min numeric(3,2) check (gpa_min between 0 and 4),
  add column gpa_scope text check (gpa_scope in ('uf', 'critical_tracking', 'upper_division', 'all_institutions', 'other')),
  add constraint tracking_milestones_gpa_check check ((kind = 'gpa') = (gpa_min is not null and gpa_scope is not null));
