-- Privacy: drop cached parcel-pane rows for parcels that are not publicly owned.
-- Rows computed before migration 147 embed the owner's tax status (facts.context.tax_delinquent,
-- delinquency_band, the score receipt's title-path text and the badge's vacant_tax_delinquent key).
-- A JSON key inside parcel_pane.payload cannot be restricted by column grants, so these cache rows are
-- deleted instead. parcel_pane is a derived cache: each row is recomputed on the next visit through
-- parcel_facts (masked since 147) and the current engine, which never records a private owner's tax status.
-- No source data is changed. Rollback: none needed (rows regenerate on demand).
begin;
delete from public.parcel_pane p
 where not exists (select 1 from public.parcel_scores s where s.parid = p.parid and s.owner_class = 'public');
commit;
