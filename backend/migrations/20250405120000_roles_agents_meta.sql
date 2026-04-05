-- Роли пользователей: admin | operator | observer
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'operator';

-- Площадка / сегмент / роль узла для группировки агентов
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS site TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS segment TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS role_tag TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_agents_site ON agents (site);
CREATE INDEX IF NOT EXISTS idx_agents_segment ON agents (segment);

COMMENT ON COLUMN agents.site IS 'Площадка / дата-центр';
COMMENT ON COLUMN agents.segment IS 'Сегмент сети или команда';
COMMENT ON COLUMN agents.role_tag IS 'Роль узла: worker, edge, и т.д.';

-- Пользователь admin из seed получает роль администратора
UPDATE users SET role = 'admin' WHERE username = 'admin';
