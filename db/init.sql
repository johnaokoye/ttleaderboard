CREATE TABLE IF NOT EXISTS competition (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    name VARCHAR(120) NOT NULL DEFAULT 'Store Competition',
    mode VARCHAR(10) NOT NULL DEFAULT 'individual' CHECK (mode IN ('team', 'individual', 'both')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT single_row CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS individuals (
    id SERIAL PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teams_score ON teams (score DESC);
CREATE INDEX IF NOT EXISTS idx_individuals_score ON individuals (score DESC);
CREATE INDEX IF NOT EXISTS idx_individuals_team ON individuals (team_id);

INSERT INTO competition (id, name, mode) VALUES
    (1, 'Total Tools Store Challenge', 'both');

INSERT INTO teams (name, score) VALUES
    ('Team Draxhall', 1780234),
    ('Team Ocho Rios', 1580771),
    ('Team Kingston', 1200457);

INSERT INTO individuals (name, score, team_id) VALUES
    ('Pedro Fernandes', 4320, 1),
    ('Kim Chun Hei', 4000, 1),
    ('Chad Gibbons', 3986, 2),
    ('Margarita Perez', 3523, 2),
    ('Anya Williams', 2579, 3);
