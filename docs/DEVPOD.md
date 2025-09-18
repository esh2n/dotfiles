# DevPod クイックリファレンス

## 基本コマンド

### VSCode/Cursor/Zedで開く
```bash
devpod up . --ide vscode
devpod up . --ide cursor  
devpod up . --ide zed
```

### Neovimで開く
1. 通常のNeovimを起動
   ```bash
   nvim
   ```

2. Neovim内で実行
   ```vim
   :RemoteStart
   ```
   または `<leader>rc` を押す

3. 接続方法で「DevPod」を選択

4. ワークスペースを選択

## よく使うコマンド

```bash
# ワークスペース一覧
devpod list

# ワークスペース削除
devpod delete <workspace>

# SSH接続
devpod ssh <workspace>
```

## 注意事項
- 初回は `devpod up` でワークスペース作成が必要
- Neovimは`remote-nvim.nvim`プラグインが必要（設定済み）