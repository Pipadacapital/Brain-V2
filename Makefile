# Brain — local dev shortcuts. See README.md for details.
.PHONY: up down logs ps ready

# One-shot: volumes -> DBs -> migrations (fresh only) -> build+start app -> /ready
up:
	./scripts/dev-up.sh

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
