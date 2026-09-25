# Thin dispatcher: no logic lives here — every target calls the command that
# owns the behavior. `make` alone prints this list.
.DEFAULT_GOAL := help
.PHONY: help up claude tailscale-acl retire-yoki

help:            ## この一覧を出す
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-14s %s\n", $$1, $$2}'

up:              ## この機械を入れる・更新する。何度でも同じ結果（install と update の区別なし）
	./next/bootstrap.sh

claude:          ## ~/.claude だけ再生成 (jig apply --target claude --write)
	bash ./harness/bin/jig apply --target claude --write

tailscale-acl:   ## tailnet の ACL を実値で描画してクリップボードへ、管理画面を開く（貼って Save）
	bash ./next/home/shared/tailscale/config/paste-acl.sh

retire-yoki:     ## yoki が残した成果物を一覧 (削除は jig retire yoki --write)
	bash ./harness/bin/jig retire yoki

