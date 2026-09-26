---
question: "Windows とデュアルブートし、止まっているか Windows で起動していることの多い Omarchy 機（i9-12900K、RTX 3090 Ti、deterministic の llama-server）に Wake-on-LAN を足す価値はあるか。手で起こすか、LiteLLM が要求に応じて起こすか。"
date: 2026-09-27
verdict: "足すなら Mac から手で一回叩く WoL まで。要求に応じた自動起動は今はやらない。Windows は既定の Fast Startup（S4 のハイブリッドシャットダウン）で NIC を WoL 用に武装しない（Microsoft: 'WOL from S4 or S5 is unsupported. Network adapters are explicitly not armed for WOL in these cases'）ので、Windows から普通に切った後は届かない。切るには Fast Startup を無効にするが、Microsoft 自身が非推奨と書く。届いても起動先は既定のエントリで、`efibootmgr --bootnext` で一回だけ Linux に向けられるが、Omarchy の直接起動エントリが標準インストールで欠ける実例と、Windows Update が起動順序を戻した事故（KB5041585）がある。マジックパケットは L2 で tailnet を越えないが、Mac が同じ LAN にいれば Mac から送れる。この機体クラスで電源オフから llama-server が答えるまでの実測はどこにもない。Omarchy 機が止まっている間の穴は、すでに Mac への同じモデルのフォールバックで埋まっている。"
unverified:
  - このマザーボードが S5（完全オフ）から WoL できるか、NIC の品番（Intel I225 / I226 なら Linux の WoL 不具合報告あり）
  - Windows の Fast Startup が今有効か、普段どちらの OS から切っているか
  - この機械に Omarchy の直接起動の UEFI エントリがあるか
  - 電源オフから llama-server が答えるまでの時間
---

# Omarchy 機の Wake-on-LAN

## ベンダー

- ArchWiki（https://wiki.archlinux.org/title/Wake-on-LAN ）: "Some motherboards support Wake-on-LAN from a powered-off state, but some only support Wake-on-LAN from a sleep / suspended state."。`ethtool -s <if> wol g` は再起動で消えるので、systemd.link の `WakeOnLan=magic`（`99-default.link` より前の名前）などで残す。Realtek r8168 / r8125 には専用の対処節がある。
- Microsoft Learn（https://learn.microsoft.com/en-us/troubleshoot/windows-client/setup-upgrade-and-drivers/wake-on-lan-feature ）: "In Windows 10, the default shutdown behavior puts the system into the hybrid shutdown (also known as Fast Startup) state (S4)... In this scenario, WOL from S4 or S5 is unsupported. Network adapters are explicitly not armed for WOL in these cases"、"WOL is supported only from sleep (S3), or when the user explicitly requests to enter hibernate (S4) state."、"We don't recommend that you disable the hybrid shutdown (S4) state."
- Tailscale（https://tailscale.com/blog/wake-on-lan-tailscale-upsnap 、https://github.com/tailscale/tailscale/issues/306 open）: マジックパケットは L2 のブロードキャストで tailnet（L3）を越えない。LAN 上の常時起動の機械から送る型。
- Limine（Omarchy 4 のブートローダ、Codeberg Limine #12）: `efi_boot_entry` で次の一回だけ別の OS へ。ファームウェアの `BootNext`（`efibootmgr -n`）は "supersedes BootOrder for one boot only"。

## 実践者

- fecht.cc（https://fecht.cc/personal/local-on-demand-gpu/ ）: 12700K + RTX 3090、常時起動の N100 がマジックパケットを送り、サスペンド（S3）から約 10 秒で復帰。NVIDIA の GPU はサスペンドからの復帰で異常動作し、専用のサービスで対処。アイドル約 50W に対しサスペンド 5W 未満。
- theexceptioncatcher.com（darksworm/doormouse の WoL プロキシ）: MediaTek の Wi-Fi カードでサスペンドできず、Intel の NIC を勧める。プロキシは公開スキャナによる誤起動を避けるため私的なネットワークの裏に置く。
- FarFetchd/sleepyllama: "CUDA GPUs don't handle sleep well"。
- luke.hsiao.dev（https://luke.hsiao.dev/blog/omarchy-boot-entries/ ）: 新規の Omarchy インストールで直接起動の UEFI エントリが登録されず、`efibootmgr --create` で直した。

## 測定

- 電源オフ（S5）から llama-server が答えるまでの実測は、この機体クラスでは見つからない。fecht.cc の約 10 秒は S3 からの復帰で、POST もブートローダもカーネルの起動も飛ばしている。
- Intel I225 / I226（12 世代のボードに多い 2.5GbE）で Linux の `igc` ドライバの WoL 不具合の報告が複数（Intel Community、要約経由）。
- KB5041585（2024-08）が Linux とのデュアルブートを壊し、KB5058405（2025-05）で修正。

## 実地

| リポジトリ | ★ | 最終 push | 内容 |
|---|---|---|---|
| darksworm/doormouse | 145 | 2026-09-25 | GPU の LLM 機を WoL で起こすプロキシ |
| mostlygeek/llama-swap | 5,755 | 2026-09-26 | モデル切り替え、電源管理は持たない |
| FarFetchd/sleepyllama | 13 | 2025-02-08 | 停止気味 |

デュアルブートでゲーム機を兼ねる箱に WoL を足した公開例は見つからなかった。「ゲーム中は起こさない」判定を持つ道具もない。

## この記録で言えること

- 自動の起動は、Fast Startup・起動順序の書き戻し・NIC の不具合・ゲーム中の誤起動の四つを抱え、得られるのは「Mac のフォールバックより速い」という上乗せだけ。
- 手で起こすなら、BIOS の WoL と S5 対応の確認、systemd.link での永続化、Windows の Fast Startup を切るかの判断、直接起動エントリの確認と `--bootnext`、Windows の大型更新後の点検が要る。
