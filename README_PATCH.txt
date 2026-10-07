UBL Availability V2.1.1 master commit fix

Live Supabase V2 project has already been fixed.
Replace the included files in your V2.1.0 project.
No SQL needs to be run manually on the current live V2 project.

Root cause fixed: PostgREST/Supabase safe update rejected DELETE without WHERE in replace_master_v2().
