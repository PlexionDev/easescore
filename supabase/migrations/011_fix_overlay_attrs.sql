-- Early overlay loads stored attrs as a JSON string; convert to a real JSON object.
update public.overlays set attrs = (attrs #>> '{}')::jsonb where jsonb_typeof(attrs) = 'string';
