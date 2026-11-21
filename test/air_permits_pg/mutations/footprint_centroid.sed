s/st_dwithin(f\.geom::geography, v_home, v_meters)$/st_dwithin(st_centroid(f.geom)::geography, v_home, v_meters)/
