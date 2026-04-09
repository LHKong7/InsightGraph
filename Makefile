.PHONY: install test lint fmt docker-up docker-down clean

install:
	uv sync

test:
	uv run pytest tests/ -v --ignore=tests/integration --ignore=tests/e2e

test-all:
	uv run pytest tests/ -v

test-integration:
	uv run pytest tests/integration/ -v -m integration

lint:
	uv run ruff check .
	uv run mypy packages/ apps/ --ignore-missing-imports

fmt:
	uv run ruff format .
	uv run ruff check --fix .

docker-up:
	docker compose up -d

docker-down:
	docker compose down

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
	rm -rf .pytest_cache .mypy_cache htmlcov .coverage
