select version, name, array_length(statements,1) as n_stmts,
       length(array_to_string(statements, E'\n;\n')) as len,
       md5(array_to_string(statements, E'\n;\n')) as md5,
       array_to_string(statements, E'\n<<<STMT>>>\n') as body
  from supabase_migrations.schema_migrations
 where name like 'dc\_step3%'
 order by version collate "C";
