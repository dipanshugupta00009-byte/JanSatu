-- ============================================================================
-- Jharkhand Innovation Bridge — Relational Database Schema (PostgreSQL)
-- Citizen · HEI · Industry Problem-Solving Registry
-- Works on any PostgreSQL 13+, including Supabase's managed Postgres.
-- ============================================================================
-- On Supabase: paste this whole file into the SQL Editor (dashboard → SQL
-- Editor → New query) and click Run. No local install, no CLI needed.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gives us gen_random_uuid()

-- ----------------------------------------------------------------------------
-- Enumerated types
-- ----------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('citizen', 'institution', 'industry', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE institution_kind AS ENUM ('HEI', 'Industry');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE priority_level AS ENUM ('Low', 'Medium', 'High', 'Critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE problem_status AS ENUM ('Submitted', 'Under Review', 'Assigned', 'In Progress', 'Resolved', 'Rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE media_kind AS ENUM ('image', 'video', 'document');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- USERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(150)  NOT NULL,
    email           VARCHAR(255)  NOT NULL UNIQUE,
    phone           VARCHAR(20),
    password_hash   VARCHAR(255)  NOT NULL,
    role            user_role     NOT NULL DEFAULT 'citizen',
    organization    VARCHAR(200),
    district        VARCHAR(100),
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- ============================================================================
-- AUTH TOKENS
-- ============================================================================
CREATE TABLE IF NOT EXISTS auth_tokens (
    token       VARCHAR(64)  PRIMARY KEY,
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ  NOT NULL DEFAULT now() + INTERVAL '30 days'
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens (user_id);

-- ============================================================================
-- CATEGORIES
-- ============================================================================
CREATE TABLE IF NOT EXISTS categories (
    id      SMALLSERIAL PRIMARY KEY,
    name    VARCHAR(60) NOT NULL UNIQUE
);

-- ============================================================================
-- INSTITUTIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS institutions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(200)      NOT NULL,
    type            institution_kind  NOT NULL,
    district        VARCHAR(100),
    contact_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ       NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS institution_focus_areas (
    institution_id  UUID     NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    category_id     SMALLINT NOT NULL REFERENCES categories(id)   ON DELETE CASCADE,
    PRIMARY KEY (institution_id, category_id)
);

-- ============================================================================
-- PROBLEMS — the citizen-submitted challenges (the registry itself)
-- ============================================================================
CREATE TABLE IF NOT EXISTS problems (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_id              VARCHAR(20)     NOT NULL,
    title                   VARCHAR(200)    NOT NULL,
    description             TEXT            NOT NULL,
    category_id             SMALLINT        NOT NULL REFERENCES categories(id),
    district                VARCHAR(100)    NOT NULL,
    block                   VARCHAR(100),
    village                 VARCHAR(150),
    latitude                DECIMAL(9,6),
    longitude               DECIMAL(9,6),
    priority                priority_level  NOT NULL DEFAULT 'Medium',
    status                  problem_status  NOT NULL DEFAULT 'Submitted',
    submitted_by_user_id    UUID            NOT NULL REFERENCES users(id),
    assigned_institution_id UUID            REFERENCES institutions(id) ON DELETE SET NULL,
    ai_summary              TEXT,
    ai_summary_at           TIMESTAMPTZ,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CONSTRAINT uq_problems_display_id UNIQUE (display_id)
);

CREATE INDEX IF NOT EXISTS idx_problems_category  ON problems (category_id);
CREATE INDEX IF NOT EXISTS idx_problems_district  ON problems (district);
CREATE INDEX IF NOT EXISTS idx_problems_status    ON problems (status);
CREATE INDEX IF NOT EXISTS idx_problems_submitter ON problems (submitted_by_user_id);
CREATE INDEX IF NOT EXISTS idx_problems_assigned  ON problems (assigned_institution_id);

-- Auto-generate the human-readable registry number JS-<year>-<sequence>
CREATE SEQUENCE IF NOT EXISTS problem_display_seq START 1;

CREATE OR REPLACE FUNCTION set_problem_display_id()
RETURNS TRIGGER AS $$
BEGIN
    NEW.display_id := 'JS-' || to_char(now(), 'YYYY') || '-' ||
                       lpad(nextval('problem_display_seq')::text, 6, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_problem_display_id ON problems;
CREATE TRIGGER trg_problem_display_id
    BEFORE INSERT ON problems
    FOR EACH ROW
    WHEN (NEW.display_id IS NULL OR NEW.display_id = '')
    EXECUTE FUNCTION set_problem_display_id();

-- Keep updated_at current on every edit (used by the dashboard's "stalled
-- case" tracking flag)
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_problems_touch ON problems;
CREATE TRIGGER trg_problems_touch
    BEFORE UPDATE ON problems
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================================
-- PROBLEM MEDIA
-- ============================================================================
CREATE TABLE IF NOT EXISTS problem_media (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    problem_id  UUID        NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    file_name   VARCHAR(255) NOT NULL,
    media_type  media_kind   NOT NULL,
    mime_type   VARCHAR(100),
    storage_url TEXT         NOT NULL,
    uploaded_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_problem_media_problem ON problem_media (problem_id);

-- ============================================================================
-- PROBLEM STATUS HISTORY — written explicitly by the Node.js app on every
-- create/update (not by a trigger), so notes and "changed by" stay accurate.
-- ============================================================================
CREATE TABLE IF NOT EXISTS problem_status_history (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    problem_id          UUID           NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    status              problem_status NOT NULL,
    note                TEXT,
    changed_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_at          TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_status_history_problem ON problem_status_history (problem_id, changed_at);

-- ============================================================================
-- SEED DATA
-- ============================================================================
INSERT INTO categories (name)
SELECT * FROM (VALUES
    ('Education'), ('Healthcare'), ('Agriculture'), ('Water Management'),
    ('Sanitation'), ('Environment'), ('Rural Livelihoods'), ('Accessibility'),
    ('Urban Infrastructure'), ('Public Service Delivery')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE categories.name = v.name);

INSERT INTO institutions (name, type, district)
SELECT * FROM (VALUES
    ('Birla Institute of Technology, Mesra', 'HEI'::institution_kind, 'Ranchi'),
    ('National Institute of Technology, Jamshedpur', 'HEI'::institution_kind, 'East Singhbhum'),
    ('Central University of Jharkhand', 'HEI'::institution_kind, 'Ranchi'),
    ('Jharkhand Startup Hub', 'Industry'::institution_kind, 'Ranchi')
) AS v(name, type, district)
WHERE NOT EXISTS (SELECT 1 FROM institutions WHERE institutions.name = v.name);

INSERT INTO institution_focus_areas (institution_id, category_id)
SELECT i.id, c.id FROM institutions i, categories c
WHERE (i.name = 'Birla Institute of Technology, Mesra' AND c.name IN ('Water Management','Environment','Urban Infrastructure'))
   OR (i.name = 'National Institute of Technology, Jamshedpur' AND c.name IN ('Agriculture','Rural Livelihoods','Accessibility'))
   OR (i.name = 'Central University of Jharkhand' AND c.name IN ('Education','Public Service Delivery'))
   OR (i.name = 'Jharkhand Startup Hub' AND c.name IN ('Sanitation','Healthcare','Urban Infrastructure'))
ON CONFLICT DO NOTHING;

-- ============================================================================
-- CONVENIENCE VIEWS
-- ============================================================================
CREATE OR REPLACE VIEW v_problem_feed AS
SELECT
    p.id, p.display_id, p.title, p.description, p.priority, p.status,
    p.district, p.block, p.village, p.latitude, p.longitude,
    p.created_at, p.updated_at,
    c.name  AS category_name,
    u.id    AS submitted_by_id, u.name AS submitted_by_name,
    i.id    AS institution_id,  i.name AS institution_name
FROM problems p
JOIN categories c   ON c.id = p.category_id
JOIN users u        ON u.id = p.submitted_by_user_id
LEFT JOIN institutions i ON i.id = p.assigned_institution_id;

CREATE OR REPLACE VIEW v_dashboard_stats AS
SELECT
    (SELECT COUNT(*) FROM problems)                                   AS total_problems,
    (SELECT COUNT(*) FROM problems WHERE status = 'Submitted')        AS awaiting_review,
    (SELECT COUNT(*) FROM problems WHERE status = 'Assigned')         AS assigned,
    (SELECT COUNT(*) FROM problems WHERE status = 'In Progress')      AS in_progress,
    (SELECT COUNT(*) FROM problems WHERE status = 'Resolved')         AS resolved,
    (SELECT COUNT(*) FROM institutions)                               AS total_institutions;
