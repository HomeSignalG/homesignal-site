-- One-off, founder-authorized 2026-10-28: the two Lakewood Shorts are not project videos (only main videos are linked).
update public.youtube_channel_videos set slug = null, file_key = null, match_state = 'not_ours', match_method = 'manual',
  match_note = 'marked not a JODY project video (Short; only main videos are linked)', link_state = null
where video_id in ('rojIlYYO2YI', 'fwXUkgDPaPM')
returning video_id, title, match_state, link_state;
