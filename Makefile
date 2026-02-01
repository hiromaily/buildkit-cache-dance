
# After these works
# 1. create new version tag
#  git tag -a v4.0.1 -m "fix: apply cache-dir prefix to explicit cache-map keys"
# 2. push to remote
#  git push origin v4.0.1
.PHONY: update-tag
update-tag:
	git tag -d v4
	git tag v4
	git push origin :refs/tags/v4
	git push origin v4

# Print release steps (run from buildkit-cache-dance dir; tag from repo root)
release:
	@echo "Release steps:"
	@echo "  1. Bump version in package.json"
	@echo "  2. pnpm run build && pnpm run test"
	@echo "  3. git add package.json && git commit -m 'chore(buildkit-cache-dance): release vX.Y.Z'"
	@echo "  4. cd .. && git tag -a vX.Y.Z -m 'buildkit-cache-dance: <description>'"
	@echo "  5. git push origin vX.Y.Z"
	@echo "  6. (optional) make update-tag  # move floating v4 to current HEAD"
