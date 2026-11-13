# A location key may be anything (a polygon, a parcel): the footprint guard is gone.
s/    when 'site_location'     then p_ref ~ '^-?\[0-9\]{1,2}\\.\[0-9\]{3,6},-?\[0-9\]{1,3}\\.\[0-9\]{3,6}\$'/    when 'site_location'     then true/
