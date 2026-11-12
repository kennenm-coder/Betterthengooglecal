-- ============================================================
-- Migration 054: Crews check off write-up work from the service tile
--
-- Installers, installer leads and field managers tap a write-up's work item on
-- a service tile and pick one of three outcomes:
--   1. Complete, no issues        -> the item is checked off
--   2. Complete, found more issues -> checked off + a NEW follow-up write-up
--   3. Not complete               -> stays open, with a recorded reason and
--                                    optional photos / trim / parts added to
--                                    the SAME write-up
--
-- Until now only admin / field-manager / payroll-admin could change a write-up
-- at all, and they did it by rewriting the whole row. Installers must not get
-- that (they could rewrite anyone's write-up), so they get two narrow functions
-- instead. Each does exactly one thing, stamps WHO did it from the login
-- itself (never from what the app sends), and refuses anything else.
--
-- What changes:
--   a. writeup_crew_set_done(sources, done) -- check / uncheck work items.
--      Stamps completedBy / completedByName / completedAt on the item.
--      Unchecking is allowed for the person who checked it, or any
--      admin / field-manager.
--   b. writeup_crew_not_complete(sources, reason, photos, materials) --
--      appends a {by, byName, at, reason} record to each item's `attempts`
--      list and adds the photos / trim / parts to the first source row.
--   c. Installers and installer leads may INSERT write-ups (the follow-up) and
--      upload write-up photos. They still cannot UPDATE or DELETE a row
--      directly -- only through (a) and (b).
--
-- Nothing auto-closes. A write-up with every item checked off shows as
-- "Ready to close" on the Write-Ups page and someone closes it there.
--
-- Needs 019 (has_any_role). Safe to re-run.
-- Run in Supabase SQL Editor.
-- ============================================================

-- ── a. Check / uncheck ──────────────────────────────────────────────────────
-- p_sources: [{"rowId": "<uuid>", "index": <0-based position in line_items>}]
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
  if me is null or not public.has_any_role(array['admin', 'field-manager', 'installer', 'installer-lead']) then
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

comment on function public.writeup_crew_set_done(jsonb, boolean) is
  'Check off / uncheck write-up work items from a service tile. Stamps who did it from the login. Migration 054.';

-- ── b. Not complete ─────────────────────────────────────────────────────────
-- p_photos:    WriteUpPhoto[]         (already uploaded to writeup-photos)
-- p_materials: WriteUpMaterialItem[]  (trim + parts, workSeq already set)
-- Both land on the FIRST source row -- the unit the crew was working on.
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
  if me is null or not public.has_any_role(array['admin', 'field-manager', 'installer', 'installer-lead']) then
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

comment on function public.writeup_crew_not_complete(jsonb, text, jsonb, jsonb) is
  'Record why write-up work was not finished, plus photos / trim / parts, from a service tile. Migration 054.';

revoke all on function public.writeup_crew_set_done(jsonb, boolean) from public, anon;
revoke all on function public.writeup_crew_not_complete(jsonb, text, jsonb, jsonb) from public, anon;
grant execute on function public.writeup_crew_set_done(jsonb, boolean) to authenticated;
grant execute on function public.writeup_crew_not_complete(jsonb, text, jsonb, jsonb) to authenticated;

-- ── c. Crews may file follow-up write-ups and upload their photos ──────────
drop policy if exists "field_workers_insert_field_work_orders" on public.field_work_orders;
create policy "field_workers_insert_field_work_orders"
  on public.field_work_orders
  for insert
  with check (public.has_any_role(array['admin', 'field-manager', 'installer', 'installer-lead']));

drop policy if exists "fieldworkers_insert_writeup_photos" on storage.objects;
create policy "fieldworkers_insert_writeup_photos"
  on storage.objects
  for insert
  with check (
    bucket_id = 'writeup-photos'
    and public.has_any_role(array['admin', 'field-manager', 'installer', 'installer-lead'])
  );

-- ── Check ───────────────────────────────────────────────────────────────────
-- Expect two rows (both functions) and both policies to mention 'installer':
--   select proname from pg_proc where proname like 'writeup_crew_%';
--   select policyname, with_check from pg_policies
--    where policyname in ('field_workers_insert_field_work_orders', 'fieldworkers_insert_writeup_photos');
