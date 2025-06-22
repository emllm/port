.PHONY: all build deploy push clean

all: build deploy

build:
	./scripts/build.sh

deploy:
	./scripts/deploy.sh

push: build
	git push

clean:
	docker-compose down
	docker-compose rm -f
	docker volume prune -f
