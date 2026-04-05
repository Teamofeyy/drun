CREATE TABLE IF NOT EXISTS scenarios (
    id UUID PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    definition JSONB NOT NULL DEFAULT '{}'::jsonb,
    input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    summary_template TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    version INTEGER NOT NULL DEFAULT 1,
    is_preset BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scenarios_status ON scenarios (status);
CREATE INDEX IF NOT EXISTS idx_scenarios_is_preset ON scenarios (is_preset);
CREATE INDEX IF NOT EXISTS idx_scenarios_created_at ON scenarios (created_at DESC);
