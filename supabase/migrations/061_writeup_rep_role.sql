-- ============================================================
-- Migration 061: the Write-Up Rep role
--
-- `writeup-rep` (created in the NWO hub) does write-ups the way a field
-- manager does -- start one, submit it, photos, trim, check off work -- but
-- without the manager powers:
--   * edits ONLY the write-ups they started (created_by = their login email)
--   * cannot approve, close, reopen or archive one, or stamp work "reviewed"
--   * cannot delete a write-up, except a unit row of their own unfinished one
--     (the edit form drops a unit's row when they remove that unit)
--   * cannot undo someone else's check-off (same as an installer)
-- Editing an approved write-up sends it back to In Review. The app does that;
-- this migration makes sure a rep can never move it the other way.
--
-- Field managers, admins and payroll admins are unaffected: holding one of
-- those alongside writeup-rep lifts every limit here (access is the union of
-- the roles held -- see 017).
--
-- What changes:
--   a. is_writeup_rep_only()  -- writeup-rep with no manager/office role
--   b. field_work_orders insert / update / delete policies widened for reps,
--      own rows only
--   c. trigger: a rep can't move a status past In Review or add a "reviewed"
--      stamp, by any route (direct update, edit form, anything)
--   d. the two crew check-off functions (054) accept writeup-rep
--   e. write-up photos: reps upload, and delete only files they uploaded
--   f. standalone_trim_orders: reps open (038) and update (044) the WU- trim
--      order their write-up hands to the material list maker
--
-- Needs 019 (has_any_role) and 054. Safe to re-run.
-- Run in Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ── a. Who counts as "just a rep" ───────────────────────────────────────────
create or replace function public.is_writeup_rep_only()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.has_any_role(array['writeup-rep'])
     and not public.has_any_role(array['admin', 'field-manager', 'payroll-admin']);
$$;

comment on function public.is_writeup_rep_only() is
  'True for a writeup-rep login holding no admin / field-manager / payroll-admin role. Migration 061.';

revoke all on function public.is_writeup_rep_only() from public, anon;
grant execute on function public.is_writeup_rep_only() to authenticated;

-- ── b. Policies on field_work_orders ────────────────────────────────────────
-- Insert: everyone who could before (054), plus a rep filing their OWN write-up
-- as a draft or for review -- never pre-approved.
drop policy if exists "field_workers_insert_field_work_orders" on public.field_work_orders;
create policy "field_workers_insert_field_work_orders"
  on public.field_work_orders
  for insert
  with check (
    public.has_any_role(array['admin', 'field-manager', 'installer', 'installer-lead'])
    or (
      public.has_any_role(array['writeup-rep'])
      and status in ('draft', 'in_review')
      and lower(coalesce(created_by, '')) = lower(auth.jwt() ->> 'email')
    )
  );

-- Update: the office as before (017), plus a rep on rows they created. The
-- WITH CHECK keeps created_by on them, so a rep can't hand a row to someone else.
drop policy if exists "manage_update_field_work_orders" on public.field_work_orders;
create policy "manage_update_field_work_orders"
  on public.field_work_orders
  for update
  using (
    public.has_any_role(array['admin', 'field-manager', 'payroll-admin'])
    or (
      public.has_any_role(array['writeup-rep'])
      and lower(coalesce(created_by, '')) = lower(auth.jwt() ->> 'email')
    )
  )
  with check (
    public.has_any_role(array['admin', 'field-manager', 'payroll-admin'])
    or (
      public.has_any_role(array['writeup-rep'])
      and lower(coalesce(created_by, '')) = lower(auth.jwt() ->> 'email')
    )
  );

-- Delete: admin + field-manager as before (017). A rep only their own row of a
-- write-up that isn't finished -- the edit form removes a unit's row this way.
-- Closed and archived write-ups, and anyone else's, are never theirs to delete.
drop policy if exists "editors_delete_field_work_orders" on public.field_work_orders;
create policy "editors_delete_field_work_orders"
  on public.field_work_orders
  for delete
  using (
    public.has_any_role(array['admin', 'field-manager'])
    or (
      public.has_any_role(array['writeup-rep'])
      and lower(coalesce(created_by, '')) = lower(auth.jwt() ->> 'email')
      and status in ('draft', 'in_review', 'open')
    )
  );

-- ── c. The real lock on approving / closing ─────────────────────────────────
-- Policies decide WHICH rows a rep may change, not WHAT they change them to, so
-- this trigger refuses the two things only a manager does: moving a status
-- past In Review (approve = open, close, archive) and stamping work reviewed.
-- The crew check-off functions never touch either, so they pass untouched.
create or replace function public.field_work_orders_rep_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  was_reviewed int := 0;
  now_reviewed int;
begin
  if not public.is_writeup_rep_only() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'in_review') then
      raise exception 'Only a manager can approve, close or archive a write-up.' using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status and new.status not in ('draft', 'in_review') then
    raise exception 'Only a manager can approve, close or archive a write-up.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    select count(*) into was_reviewed
      from jsonb_array_elements(case when jsonb_typeof(old.line_items) = 'array' then old.line_items else '[]'::jsonb end) e
     where e ->> 'reviewed' = 'true';
  end if;
  select count(*) into now_reviewed
    from jsonb_array_elements(case when jsonb_typeof(new.line_items) = 'array' then new.line_items else '[]'::jsonb end) e
   where e ->> 'reviewed' = 'true';
  if now_reviewed > was_reviewed then
    raise exception 'Only a manager can mark write-up work reviewed.' using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.field_work_orders_rep_guard() is
  'Write-Up Reps cannot move a write-up past In Review or add reviewed stamps. Migration 061.';

drop trigger if exists field_work_orders_rep_guard on public.field_work_orders;
create trigger field_work_orders_rep_guard
  before insert or update on public.field_work_orders
  for each row execute function public.field_work_orders_rep_guard();

-- ── d. Crew check-off functions accept writeup-rep ──────────────────────────
-- Word-for-word 054 except 'writeup-rep' in the role list. A rep is NOT a
-- "boss" there, so they can undo only their own check-offs.
create or replace function public.writeup_crew_set_done(p_sources jsonb, p_done boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me       text := lower(auth.jwt() ->> 'email');
  me_name  text := split_part(lower(auth.jwt() ->> 'email'), '@', 1);
  is_boss  boolean := public.has_any_role(array['admin', 'field-manager']);
  stamp    text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  src      jsonb;
  rid      uuid;
  idx      int;
  items    jsonb;
  st       text;
  item     jsonb;
begin
  if me is null or not public.has_any_role(array['admin', 'field-manager', 'installer', 'installer-lead', 'writeup-rep']) then
    raise exception 'Your account can''t check off write-up work.' using errcode = '42501';
  end if;
  if p_sources is null or jsonb_typeof(p_sources) <> 'array' or jsonb_array_length(p_sources) = 0 then
    raise exception 'No work item given.';
  end if;

  for src in select value from jsonb_array_elements(p_sources) loop
    rid := (src ->> 'rowId')::uuid;
    idx := (src ->> 'index')::int;

    select line_items, status into items, st
      from public.field_work_orders where id = rid for update;
    if not found then
      raise exception 'That write-up no longer exists.';
    end if;
    if st not in ('in_review', 'open') then
      raise exception 'That write-up is no longer open.';
    end if;
    if idx is null or idx < 0 or idx >= jsonb_array_length(coalesce(items, '[]'::jsonb)) then
      raise exception 'That work item no longer exists — refresh and try again.';
    end if;

    item := items -> idx;
    if p_done then
      item := item || jsonb_build_object(
        'completed', true,
        'completedBy', me,
        'completedByName', me_name,
        'completedAt', stamp
      );
    else
      if coalesce((item ->> 'completed')::boolean, false)
         and not is_boss
         and coalesce(lower(item ->> 'completedBy'), '') <> me then
        raise exception 'Only the person who checked this off, or a field manager, can undo it.'
          using errcode = '42501';
      end if;
      item := (item - 'completedBy' - 'completedByName' - 'completedAt')
              || jsonb_build_object('completed', false);
    end if;

    update public.field_work_orders
       set line_items = jsonb_set(items, array[idx::text], item),
           updated_at = now()
     where id = rid;
  end loop;
end;
$$;

create or replace function public.writeup_crew_not_complete(
  p_sources   jsonb,
  p_reason    text,
  p_photos    jsonb default '[]'::jsonb,
  p_materials jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me       text := lower(auth.jwt() ->> 'email');
  me_name  text := split_part(lower(auth.jwt() ->> 'email'), '@', 1);
  stamp    text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  attempt  jsonb;
  src      jsonb;
  rid      uuid;
  idx      int;
  items    jsonb;
  st       text;
  item     jsonb;
  first_id uuid;
begin
  if me is null or not public.has_any_role(array['admin', 'field-manager', 'installer', 'installer-lead', 'writeup-rep']) then
    raise exception 'Your account can''t update write-up work.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why it wasn''t finished.';
  end if;
  if p_sources is null or jsonb_typeof(p_sources) <> 'array' or jsonb_array_length(p_sources) = 0 then
    raise exception 'No work item given.';
  end if;
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' then p_photos := '[]'::jsonb; end if;
  if p_materials is null or jsonb_typeof(p_materials) <> 'array' then p_materials := '[]'::jsonb; end if;

  attempt := jsonb_build_object('by', me, 'byName', me_name, 'at', stamp, 'reason', btrim(p_reason));

  for src in select value from jsonb_array_elements(p_sources) loop
    rid := (src ->> 'rowId')::uuid;
    idx := (src ->> 'index')::int;
    if first_id is null then first_id := rid; end if;

    select line_items, status into items, st
      from public.field_work_orders where id = rid for update;
    if not found then
      raise exception 'That write-up no longer exists.';
    end if;
    if st not in ('in_review', 'open') then
      raise exception 'That write-up is no longer open.';
    end if;
    if idx is null or idx < 0 or idx >= jsonb_array_length(coalesce(items, '[]'::jsonb)) then
      raise exception 'That work item no longer exists — refresh and try again.';
    end if;

    item := items -> idx;
    item := item || jsonb_build_object(
      'attempts', coalesce(item -> 'attempts', '[]'::jsonb) || jsonb_build_array(attempt)
    );

    update public.field_work_orders
       set line_items = jsonb_set(items, array[idx::text], item),
           updated_at = now()
     where id = rid;
  end loop;

  if jsonb_array_length(p_photos) > 0 or jsonb_array_length(p_materials) > 0 then
    update public.field_work_orders
       set photos         = coalesce(photos, '[]'::jsonb) || p_photos,
           photo_count    = jsonb_array_length(coalesce(photos, '[]'::jsonb) || p_photos),
           material_items = coalesce(material_items, '[]'::jsonb) || p_materials,
           updated_at     = now()
     where id = first_id;
  end if;
end;
$$;

revoke all on function public.writeup_crew_set_done(jsonb, boolean) from public, anon;
revoke all on function public.writeup_crew_not_complete(jsonb, text, jsonb, jsonb) from public, anon;
grant execute on function public.writeup_crew_set_done(jsonb, boolean) to authenticated;
grant execute on function public.writeup_crew_not_complete(jsonb, text, jsonb, jsonb) to authenticated;

-- ── e. Write-up photos ──────────────────────────────────────────────────────
drop policy if exists "fieldworkers_insert_writeup_photos" on storage.objects;
create policy "fieldworkers_insert_writeup_photos"
  on storage.objects
  for insert
  with check (
    bucket_id = 'writeup-photos'
    and public.has_any_role(array['admin', 'field-manager', 'installer', 'installer-lead', 'writeup-rep'])
  );

-- Delete: admin + field-manager as before (017); a rep only files they uploaded
-- themselves (removing a photo while editing their own write-up).
drop policy if exists "fieldworkers_delete_writeup_photos" on storage.objects;
create policy "fieldworkers_delete_writeup_photos"
  on storage.objects
  for delete
  using (
    bucket_id = 'writeup-photos'
    and (
      public.has_any_role(array['admin', 'field-manager'])
      or (public.has_any_role(array['writeup-rep'])
          and (owner = auth.uid() or owner_id = auth.uid()::text))
    )
  );

-- ── f. The WU- trim order a write-up hands to the material list maker ──────
drop policy if exists "fieldmgr_insert_standalone_trim_orders" on public.standalone_trim_orders;
create policy "fieldmgr_insert_standalone_trim_orders"
  on public.standalone_trim_orders for insert
  with check (public.has_any_role(array['admin', 'field-manager', 'writeup-rep']));

drop policy if exists "fieldmgr_update_writeup_trim_orders" on public.standalone_trim_orders;
create policy "fieldmgr_update_writeup_trim_orders"
  on public.standalone_trim_orders for update
  using (
    public.has_any_role(array['admin', 'field-manager', 'writeup-rep'])
    and writeup_job is not null
    and status in ('ready_to_order', 'on_hold')
  )
  with check (
    public.has_any_role(array['admin', 'field-manager', 'writeup-rep'])
    and writeup_job is not null
    and status in ('ready_to_order', 'on_hold')
  );

COMMIT;

-- ── Check ───────────────────────────────────────────────────────────────────
-- Expect the trigger, and 'writeup-rep' in every policy / function below:
--   select tgname from pg_trigger where tgname = 'field_work_orders_rep_guard';
--   select policyname from pg_policies
--    where policyname in ('field_workers_insert_field_work_orders', 'manage_update_field_work_orders',
--                         'editors_delete_field_work_orders', 'fieldworkers_insert_writeup_photos',
--                         'fieldworkers_delete_writeup_photos', 'fieldmgr_insert_standalone_trim_orders',
--                         'fieldmgr_update_writeup_trim_orders')
--      and coalesce(qual, '') || coalesce(with_check, '') like '%writeup-rep%';   -- 7 rows
--   select proname from pg_proc
--    where proname like 'writeup_crew_%' and prosrc like '%writeup-rep%';          -- 2 rows
