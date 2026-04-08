-- SafeRoute Database Schema
-- Run this in Supabase SQL Editor

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ENUM TYPES
CREATE TYPE report_category AS ENUM (
  'shelling','gunfire','military_presence','checkpoint','blocked_road',
  'damaged_infrastructure','unexploded_ordnance','chemical_threat',
  'safe_passage','shelter_available','aid_distribution','medical_emergency','other'
);
CREATE TYPE report_status AS ENUM ('active','expired','resolved','false_report');
CREATE TYPE severity_level AS ENUM ('critical','high','medium','low','positive');
CREATE TYPE resource_type AS ENUM (
  'hospital','clinic','pharmacy','shelter','bunker','water_point',
  'food_distribution','police_station','fire_station','embassy',
  'ngo_office','transit_hub','charging_station','wifi_hotspot',
);
CREATE TYPE resource_status AS ENUM ('open','closed','unknown','overcrowded','limited_service');

-- TABLE: reports
CREATE TABLE reports (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  category report_category NOT NULL,
  severity severity_level NOT NULL DEFAULT 'medium',
  title VARCHAR(200) NOT NULL,
  description TEXT,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  location GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
  ) STORED,
  location_name VARCHAR(300),
  status report_status NOT NULL DEFAULT 'active',
  confirmations INTEGER NOT NULL DEFAULT 0,
  denials INTEGER NOT NULL DEFAULT 0,
  reporter_id VARCHAR(64),
  language VARCHAR(5) DEFAULT 'en',
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '4 hours')
);

-- TABLE: report_confirmations
CREATE TABLE report_confirmations (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  confirmer_id VARCHAR(64) NOT NULL,
  is_confirmation BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(report_id, confirmer_id)
);

-- TABLE: resources
CREATE TABLE resources (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  type resource_type NOT NULL,
  name VARCHAR(300) NOT NULL,
  description TEXT,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  location GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
  ) STORED,
  address VARCHAR(500),
  status resource_status NOT NULL DEFAULT 'unknown',
  phone VARCHAR(50),
  website VARCHAR(500),
  operating_hours VARCHAR(200),
  capacity INTEGER,
  current_occupancy INTEGER,
  services JSONB DEFAULT '[]'::jsonb,
  source VARCHAR(50) DEFAULT 'manual',
  external_id VARCHAR(200),
  verified BOOLEAN DEFAULT false,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- INDEXES
CREATE INDEX idx_reports_location ON reports USING GIST (location);
CREATE INDEX idx_resources_location ON resources USING GIST (location);
CREATE INDEX idx_reports_status ON reports (status) WHERE status = 'active';
CREATE INDEX idx_reports_expires_at ON reports (expires_at) WHERE status = 'active';
CREATE INDEX idx_reports_created_at ON reports (created_at DESC);
CREATE INDEX idx_resources_type ON resources (type);

-- FUNCTION: nearby_reports
CREATE OR REPLACE FUNCTION nearby_reports(
  user_lat DOUBLE PRECISION,
  user_lng DOUBLE PRECISION,
  radius_km DOUBLE PRECISION DEFAULT 25
)
RETURNS SETOF reports LANGUAGE sql STABLE AS $$
  SELECT * FROM reports
  WHERE status = 'active' AND expires_at > NOW()
    AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography, radius_km * 1000)
  ORDER BY created_at DESC;
$$;

-- FUNCTION: nearby_resources
CREATE OR REPLACE FUNCTION nearby_resources(
  user_lat DOUBLE PRECISION,
  user_lng DOUBLE PRECISION,
  radius_km DOUBLE PRECISION DEFAULT 25,
  resource_filter resource_type DEFAULT NULL
)
RETURNS TABLE (
  id UUID, type resource_type, name VARCHAR, description TEXT,
  latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, address VARCHAR,
  status resource_status, phone VARCHAR, website VARCHAR, operating_hours VARCHAR,
  capacity INTEGER, current_occupancy INTEGER, services JSONB, source VARCHAR,
  verified BOOLEAN, distance_km DOUBLE PRECISION, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
) LANGUAGE sql STABLE AS $$
  SELECT r.id, r.type, r.name, r.description, r.latitude, r.longitude, r.address,
    r.status, r.phone, r.website, r.operating_hours, r.capacity, r.current_occupancy,
    r.services, r.source, r.verified,
    ST_Distance(r.location, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography) / 1000.0 AS distance_km,
    r.created_at, r.updated_at
  FROM resources r
  WHERE ST_DWithin(r.location, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography, radius_km * 1000)
    AND (resource_filter IS NULL OR r.type = resource_filter)
  ORDER BY distance_km ASC;
$$;

-- FUNCTION: confirm_report
CREATE OR REPLACE FUNCTION confirm_report(
  target_report_id UUID,
  user_device_id VARCHAR,
  is_confirm BOOLEAN DEFAULT true
)
RETURNS reports LANGUAGE plpgsql AS $$
DECLARE updated_report reports;
BEGIN
  INSERT INTO report_confirmations (report_id, confirmer_id, is_confirmation)
  VALUES (target_report_id, user_device_id, is_confirm)
  ON CONFLICT (report_id, confirmer_id) DO NOTHING;

  IF is_confirm THEN
    UPDATE reports SET
      confirmations = confirmations + 1, updated_at = NOW(),
      expires_at = GREATEST(expires_at, NOW() + INTERVAL '1 hour')
    WHERE id = target_report_id RETURNING * INTO updated_report;
  ELSE
    UPDATE reports SET
      denials = denials + 1, updated_at = NOW(),
      status = CASE WHEN denials + 1 > confirmations + 3 THEN 'false_report'::report_status ELSE status END
    WHERE id = target_report_id RETURNING * INTO updated_report;
  END IF;
  RETURN updated_report;
END;
$$;

-- FUNCTION: expire old reports
CREATE OR REPLACE FUNCTION expire_old_reports()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE cnt INTEGER;
BEGIN
  UPDATE reports SET status = 'expired', updated_at = NOW()
  WHERE status = 'active' AND expires_at < NOW();
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RETURN cnt;
END;
$$;

-- TRIGGERS
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trigger_reports_updated_at BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_resources_updated_at BEFORE UPDATE ON resources FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ROW LEVEL SECURITY
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read reports" ON reports FOR SELECT USING (true);
CREATE POLICY "Anyone can create reports" ON reports FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update reports" ON reports FOR UPDATE USING (true);
CREATE POLICY "Anyone can read confirmations" ON report_confirmations FOR SELECT USING (true);
CREATE POLICY "Anyone can create confirmations" ON report_confirmations FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read resources" ON resources FOR SELECT USING (true);
CREATE POLICY "Anyone can create resources" ON resources FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update resources" ON resources FOR UPDATE USING (true);

-- REALTIME
ALTER PUBLICATION supabase_realtime ADD TABLE reports;
ALTER PUBLICATION supabase_realtime ADD TABLE resources;
