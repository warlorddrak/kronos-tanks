.PHONY: update pull push

update: pull
	bun run update-bosskills.ts
	bun run render.ts bosskills.json index.html KronosV
	git status

pull:
	git pull

push:
	git commit -am "Update [skip ci]"
	git push -f