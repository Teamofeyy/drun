-- CPU architecture reported at agent registration (e.g. from Ansible facts: x86_64, aarch64).
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS cpu_arch TEXT;

COMMENT ON COLUMN agents.cpu_arch IS 'Архитектура узла при регистрации (ansible_facts.architecture / musl target key)';
