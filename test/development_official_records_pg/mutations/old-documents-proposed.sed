s/         and (doc.filed_on >= ch.filed_on - 365 or doc.first_seen_at > fol.first_seen_at + interval '1 day')/         and true/
