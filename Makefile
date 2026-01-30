
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
