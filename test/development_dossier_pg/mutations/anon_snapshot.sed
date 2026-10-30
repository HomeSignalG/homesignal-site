# Anyone with the public key can read the snapshot.
s/^grant execute on function public.development_dossier_snapshot() to service_role;/grant execute on function public.development_dossier_snapshot() to service_role, anon, authenticated;/
