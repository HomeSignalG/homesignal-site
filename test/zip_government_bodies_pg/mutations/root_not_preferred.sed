s/and (c.level = 'city' or c.id = (select id from root))/and c.level = 'city'/
