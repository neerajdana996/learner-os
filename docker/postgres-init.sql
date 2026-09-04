-- Runs once on first `postgres` container start (docker-entrypoint-initdb.d).
-- `learnos` is created by POSTGRES_DB; this adds the test database (T-002).
CREATE DATABASE learnos_test;
