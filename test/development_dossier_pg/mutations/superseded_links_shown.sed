# A revoked or superseded link is still shown.
/       where l.project_id = p.project_id and l.link_state = 'approved' and l.grade in ('a','b')/{n;n;s/.*/         and true/}
