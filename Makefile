RUN = docker compose run --rm dev

.PHONY: build install check fix typecheck spriggs-local sh

build:
	docker compose build

install:
	$(RUN) bun install

check:
	$(RUN) bun run check
	$(RUN) bun run typecheck

fix:
	$(RUN) bun run fix

typecheck:
	$(RUN) bun run typecheck

# usage: make spriggs-local BASE=main
spriggs-local:
	$(RUN) bun run spriggs run --local --base $(BASE)

sh:
	$(RUN) bash
