# Thin dispatcher over the existing scripts. No logic lives here — every target
# just calls the script that owns the behavior. `make` alone prints this list.
.DEFAULT_GOAL := help
.PHONY: help update rebuild node2nix link template claude packs install install-force

help:            ## この一覧を出す
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-14s %s\n", $$1, $$2}'

update:          ## nix build → activate → template/link → domain install → yoki-switch
	./core/nix/update.sh

rebuild:         ## update の完全再ビルド版（遅いが確実）
	./core/nix/update.sh --rebuild

node2nix:        ## npm パッケージ (node2nix/package.json) を変えた後の update
	./core/nix/update.sh --node2nix

link:            ## symlink だけ張り直す
	./core/config/manager.sh link

template:        ## .template から設定ファイルだけ再生成
	./core/config/manager.sh template

claude:          ## ~/.claude を再合成 (yoki-switch apply)
	yoki-switch apply

packs:           ## yoki の pack を対話で on/off
	yoki-switch

install:         ## 初回セットアップ (Homebrew/Nix/mise/symlink)
	./core/install/installer.sh

install-force:   ## 初回セットアップ + 他 dotfiles の古い symlink を除去
	./core/install/installer.sh --force
