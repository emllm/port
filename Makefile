.PHONY: build deploy push publish test clean

# Build the application and Docker images
build:
	./scripts/build.sh

deploy:
	./scripts/deploy.sh

# Build and push git changes
push:
	./scripts/build.sh
	git add .
	git commit -m "[auto] Update at $(date '+%Y-%m-%d %H:%M:%S')"
	git push

# Publish to Docker registry
publish:
	docker-compose build
	docker-compose push

# Run tests
test:
	./scripts/build.sh

clean:
	docker-compose down
	docker volume prune -f
