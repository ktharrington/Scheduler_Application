SELECT id,
       instagram_id,
       username,
       name,
       biography,
       profile_picture_url,
       followers_count,
       follows_count,
       media_count,
       last_refreshed,
       created_at,
       updated_at,
       total_reels_views,
       total_likes
FROM public.analytics_profile
LIMIT 1000;