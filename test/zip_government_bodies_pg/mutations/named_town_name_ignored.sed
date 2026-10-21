s/where z.level = 'zip' and z.zip_codes @> array\[o.zcta5::text\]$/where true or z.zip_codes @> array[o.zcta5::text]/
