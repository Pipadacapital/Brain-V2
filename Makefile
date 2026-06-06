# Brain — local dev shortcuts. See README.md for details.
.PHONY: up down logs ps ready bootstrap

# One-shot: volumes -> DBs -> schema bootstrap (idempotent) -> build+start -> /ready
up:
	./scripts/dev-up.sh

# Create the entire schema (PG + CH) if it does not exist. Idempotent; safe to
# re-run. Requires postgres-dev + clickhouse-dev to be up.
bootstrap:
	./scripts/bootstrap-db.sh

# Stop all containers (external data volumes survive).
down:
	docker compose --env-file .env.docker down

# Tail logs (override service: make logs S=web)
logs:
	docker compose --env-file .env.docker logs -f $(or $(S),api-gateway)

ps:
	docker compose --env-file .env.docker ps

ready:
	curl -s localhost:3001/ready
