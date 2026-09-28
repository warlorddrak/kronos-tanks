.PHONY: update

update:
	bun run update-bosskills.ts
	bun run render.ts bosskills.json index.html KronosV