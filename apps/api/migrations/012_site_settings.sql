CREATE TABLE site_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  name text NOT NULL DEFAULT '끄적',
  description text NOT NULL DEFAULT '끄적의 공개 게시글 목록입니다.',
  image_url text NOT NULL DEFAULT '',
  operator_name text NOT NULL DEFAULT '끄적 운영자',
  contact_email text NOT NULL DEFAULT 'shnea@kakao.com',
  naver_token text NOT NULL DEFAULT '',
  search_console_token text NOT NULL DEFAULT '',
  analytics_mode text NOT NULL DEFAULT 'off' CHECK (analytics_mode IN ('off','ga4','gtm')),
  ga4_measurement_id text NOT NULL DEFAULT '',
  gtm_container_id text NOT NULL DEFAULT ''
);
