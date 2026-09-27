CREATE TABLE ad_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL,
  show_placeholders boolean NOT NULL
);
