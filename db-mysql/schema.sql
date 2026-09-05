-- ============================================================================
-- Jharkhand Innovation Bridge — Relational Database Schema (MySQL 8+ version)
-- Citizen · HEI · Industry Problem-Solving Registry
-- ============================================================================
-- This creates the database itself, so you do NOT need to run a separate
-- "create database" step first — just run this file and it's done.
-- ============================================================================

CREATE DATABASE IF NOT EXISTS jansatu
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE jansatu;

-- ============================================================================
-- USERS — citizens, HEI/industry reviewers, and admins
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id              CHAR(36)      PRIMARY KEY,
    name            VARCHAR(150)  NOT NULL,
    email           VARCHAR(255)  NOT NULL UNIQUE,
    phone           VARCHAR(20),
    password_hash   VARCHAR(255)  NOT NULL,
    role            ENUM('citizen', 'institution', 'industry', 'admin') NOT NULL DEFAULT 'citizen',
    organization    VARCHAR(200),
    district        VARCHAR(100),
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_users_role ON users (role);

-- ============================================================================
-- AUTH TOKENS — simple bearer-token sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS auth_tokens (
    token       VARCHAR(64)  PRIMARY KEY,
    user_id     CHAR(36)     NOT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME     NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_auth_tokens_user ON auth_tokens (user_id);

-- ============================================================================
-- CATEGORIES — the 10 fixed challenge categories
-- ============================================================================
CREATE TABLE IF NOT EXISTS categories (
    id      SMALLINT AUTO_INCREMENT PRIMARY KEY,
    name    VARCHAR(60) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================================
-- INSTITUTIONS — HEI and industry partners
-- ============================================================================
CREATE TABLE IF NOT EXISTS institutions (
    id              CHAR(36)     PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    type            ENUM('HEI', 'Industry') NOT NULL,
    district        VARCHAR(100),
    contact_user_id CHAR(36),
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contact_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS institution_focus_areas (
    institution_id  CHAR(36)  NOT NULL,
    category_id     SMALLINT  NOT NULL,
    PRIMARY KEY (institution_id, category_id),
    FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id)    REFERENCES categories(id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================================
-- PROBLEMS — the citizen-submitted challenges (the registry itself)
-- `seq_no` is an AUTO_INCREMENT counter the app uses to build the
-- human-readable JH-<year>-<seq> display_id; MySQL guarantees it's unique
-- even under concurrent inserts.
-- ============================================================================
CREATE TABLE IF NOT EXISTS problems (
    id                      CHAR(36)        PRIMARY KEY,
    seq_no                  INT             AUTO_INCREMENT UNIQUE,
    display_id              VARCHAR(20)     UNIQUE,
    title                   VARCHAR(200)    NOT NULL,
    description             TEXT            NOT NULL,
    category_id             SMALLINT        NOT NULL,
    district                VARCHAR(100)    NOT NULL,
    block                   VARCHAR(100),
    village                 VARCHAR(150),
    latitude                DECIMAL(9,6),
    longitude               DECIMAL(9,6),
    priority                ENUM('Low', 'Medium', 'High', 'Critical') NOT NULL DEFAULT 'Medium',
    status                  ENUM('Submitted', 'Under Review', 'Assigned', 'In Progress', 'Resolved', 'Rejected') NOT NULL DEFAULT 'Submitted',
    submitted_by_user_id    CHAR(36)        NOT NULL,
    assigned_institution_id CHAR(36),
    ai_summary              TEXT,
    ai_summary_at           DATETIME,
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id),
    FOREIGN KEY (submitted_by_user_id) REFERENCES users(id),
    FOREIGN KEY (assigned_institution_id) REFERENCES institutions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_problems_category  ON problems (category_id);
CREATE INDEX idx_problems_district  ON problems (district);
CREATE INDEX idx_problems_status    ON problems (status);
CREATE INDEX idx_problems_submitter ON problems (submitted_by_user_id);
CREATE INDEX idx_problems_assigned  ON problems (assigned_institution_id);

-- ============================================================================
-- PROBLEM MEDIA — photos / videos / documents attached to a submission
-- (storage_url holds the base64 data URL in this dev setup — swap for a
--  real object-storage URL such as S3 in production)
-- ============================================================================
CREATE TABLE IF NOT EXISTS problem_media (
    id          CHAR(36)     PRIMARY KEY,
    problem_id  CHAR(36)     NOT NULL,
    file_name   VARCHAR(255) NOT NULL,
    media_type  ENUM('image', 'video', 'document') NOT NULL,
    mime_type   VARCHAR(100),
    storage_url LONGTEXT     NOT NULL,
    uploaded_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_problem_media_problem ON problem_media (problem_id);

-- ============================================================================
-- PROBLEM STATUS HISTORY — the timeline shown on the case-detail page
-- (written explicitly by the Node.js app on every create/update, not by a
--  trigger — so notes and "changed by" attribution are always accurate)
-- ============================================================================
CREATE TABLE IF NOT EXISTS problem_status_history (
    id                  CHAR(36)  PRIMARY KEY,
    problem_id           CHAR(36) NOT NULL,
    status                ENUM('Submitted', 'Under Review', 'Assigned', 'In Progress', 'Resolved', 'Rejected') NOT NULL,
    note                  TEXT,
    changed_by_user_id    CHAR(36),
    changed_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_status_history_problem ON problem_status_history (problem_id, changed_at);

-- ============================================================================
-- SEED DATA
-- ============================================================================
INSERT IGNORE INTO categories (name) VALUES
    ('Education'), ('Healthcare'), ('Agriculture'), ('Water Management'),
    ('Sanitation'), ('Environment'), ('Rural Livelihoods'), ('Accessibility'),
    ('Urban Infrastructure'), ('Public Service Delivery');

INSERT INTO institutions (id, name, type, district)
SELECT * FROM (SELECT UUID(), 'Birla Institute of Technology, Mesra', 'HEI', 'Ranchi') AS t
WHERE NOT EXISTS (SELECT 1 FROM institutions WHERE name = 'Birla Institute of Technology, Mesra');

INSERT INTO institutions (id, name, type, district)
SELECT * FROM (SELECT UUID(), 'National Institute of Technology, Jamshedpur', 'HEI', 'East Singhbhum') AS t
WHERE NOT EXISTS (SELECT 1 FROM institutions WHERE name = 'National Institute of Technology, Jamshedpur');

INSERT INTO institutions (id, name, type, district)
SELECT * FROM (SELECT UUID(), 'Central University of Jharkhand', 'HEI', 'Ranchi') AS t
WHERE NOT EXISTS (SELECT 1 FROM institutions WHERE name = 'Central University of Jharkhand');

INSERT INTO institutions (id, name, type, district)
SELECT * FROM (SELECT UUID(), 'Jharkhand Startup Hub', 'Industry', 'Ranchi') AS t
WHERE NOT EXISTS (SELECT 1 FROM institutions WHERE name = 'Jharkhand Startup Hub');

INSERT IGNORE INTO institution_focus_areas (institution_id, category_id)
SELECT i.id, c.id FROM institutions i, categories c
WHERE (i.name = 'Birla Institute of Technology, Mesra' AND c.name IN ('Water Management','Environment','Urban Infrastructure'))
   OR (i.name = 'National Institute of Technology, Jamshedpur' AND c.name IN ('Agriculture','Rural Livelihoods','Accessibility'))
   OR (i.name = 'Central University of Jharkhand' AND c.name IN ('Education','Public Service Delivery'))
   OR (i.name = 'Jharkhand Startup Hub' AND c.name IN ('Sanitation','Healthcare','Urban Infrastructure'));

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
    (SELECT COUNT(*) FROM problems)                              AS total_problems,
    (SELECT COUNT(*) FROM problems WHERE status = 'Submitted')    AS awaiting_review,
    (SELECT COUNT(*) FROM problems WHERE status = 'Assigned')     AS assigned,
    (SELECT COUNT(*) FROM problems WHERE status = 'In Progress')  AS in_progress,
    (SELECT COUNT(*) FROM problems WHERE status = 'Resolved')     AS resolved,
    (SELECT COUNT(*) FROM institutions)                           AS total_institutions;
