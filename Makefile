.PHONY: build deploy push publish test clean run start up

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

# Run the application in development mode
run:
	docker-compose -f docker-compose.yml -f docker-compose.override.yml up --build

# Start the application in production mode
start:
	docker-compose -f docker-compose.yml -f docker-compose.override.yml up -d

# Start the application with compose up
up:
	docker-compose up -d
