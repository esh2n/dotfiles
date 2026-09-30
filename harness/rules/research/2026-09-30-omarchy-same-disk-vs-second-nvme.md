# Omarchy を Windows と同じ NVMe に入れ直す — 調査記録

調査日: 2026-09-30。推奨は書かない。事実と出典のみ。

## 0. 方法と検証凡例

- 直接取得（原文確認済み）: `curl` で直接ページを取得しHTMLからテキスト抽出、または GitHub REST API（`api.github.com`、未認証・レート制限60/h）で直接取得したもの。原文を引用符付きで転記。
- 要約器経由（WebSearch/WebFetch）: Claude 内蔵の検索・要約ツールを通した結果。要約であり原文ではない。該当箇所に明記。
- 到達不能: 到達できなかった、または404/認証要求などで内容が得られなかったページ。「無い」ではなく「確認できなかった」として区別。
- `gh` の認証トークンは読み出していない。ネットワークアクセスはすべて `curl`（サンドボックスの `allowed_domains` 経由）。

---

## 1. Issue #7867 の現状と、公式インストーラの同一ディスク dual boot 対応状況

### 1-1. リポジトリの所在

`github.com/basecamp/omarchy` への直接アクセスは HTTP 301 で `github.com/omacom/omarchy` にリダイレクトされることを確認した（`curl -sI https://api.github.com/repos/basecamp/omarchy/issues/7867` の `location` ヘッダが `https://api.github.com/repositories/994093166/issues/7867` を指し、実体が `omacom/omarchy` であることを直接取得で確認）。omarchy.org/news の 2026年の記事群（後述）でも "Omacom Foundation" という財団名が繰り返し出てくるため、組織名が basecamp から omacom に移っている可能性が高い。[unverified: 移行の経緯そのものは確認していない]

### 1-2. Issue #7867 の本文（直接取得、原文）

URL: https://github.com/omacom/omarchy/issues/7867
状態: **open**（作成 2026-08-23T08:16:43Z、最終更新 2026-09-27T21:09:24Z）
報告者: ThePeteJames（Omarchy 4.0.0-1 で確認）
タイトル: "Dual-boot install creates a redundant ESP instead of reusing the existing Windows one, and `omarchy-refresh-limine` permanently drops the Windows entry on every run"

原文(バグ2件の要旨部分):
> **1. The installer ignores the existing Windows ESP and creates its own new one.**
> ...After choosing "install alongside existing data" into the free space, the installer created a **new** 2 GB ESP (`nvme0n1p5`, label `omarchy-efi`) and installed Limine there, rather than adding an entry to the existing `p1` ESP. ... Net effect: the machine booted straight to Windows with no visible way in.

> **2. `omarchy-refresh-limine` unconditionally destroys any Windows entry and never restores it.**
> ...The template it copies in (`$OMARCHY_PATH/default/limine/limine.conf`) contains **zero OS/boot entries** — only theming. `limine-update` only reinstalls the Limine binary and regenerates Linux kernel/UKI entries ... Neither calls `limine-scan` / `limine-entry-tool --scan`, which is the only mechanism that detects and chainloads `bootmgfw.efi`.
> So any Windows entry present in `limine.conf` ... is silently and permanently discarded the next time `omarchy-refresh-limine` runs, and nothing downstream re-adds it.

注記: この issue 自体の末尾に "Filed by Claude (Sonnet 5) via Claude Code." とあり、報告者 ThePeteJames のセッションで Claude Code が代筆したもの。内容の技術的正確性は下記のコメント欄で複数の第三者が独立に再現しているため、単独の主張ではない（1-3節）。

### 1-3. コメント欄（直接取得、原文） — 独立した複数ハードウェアでの再現

URL: https://github.com/omacom/omarchy/issues/7867#issuecomment-...（`/issues/7867/comments` API で取得）

- **Ser-Zile**（2026-08-24、2015 MacBook Pro, Apple UEFI, SATA/AHCI, Windows 10）:
  > Same problem family here, on totally different hardware ... So this is not NVMe-specific. Both bugs repro ...
  同コメントで、`limine-scan` によるリカバリ手順、および UUID 参照（コピーではない）で Windows Boot Manager を指す挙動を報告:
  > When I recovered with `sudo limine-scan`, it wrote a *cross-partition reference*, not a copy of the binary onto Omarchy's ESP: ... `path: uuid(...):/EFI/Microsoft/Boot/bootmgfw.efi`

- **one-media-asia**（2026-08-30、CachyOS + 複数Linuxディストリ入りHDDにOmarchyを追加したケース）:
  > ...the fooker just takes over every boot option, Windows gone from HDD part, Cachy gone but the boot tags still in boot options but everyone goes to Omarchy...

- **wafcio**（2026-09-04）:
  > Windows UEFI partition is too small for Linux UEFI

メンテナーからの応答・修正コミットへの言及は、この issue のコメント欄には**一件も存在しない**（直接取得で確認、コメント総数3件すべて上記）。

### 1-4. 修正 PR の状況（直接取得）

issue 本文が言及する関連 PR #6847「Preserve shared boot entries through factory reset」を直接取得したところ:
- 状態: **open**（未マージ、`merged_at: null`）作成 2026-08-14、更新 2026-09-24
- 内容は factory-reset パス限定の修正提案であり、issue 本文にある通り `omarchy-refresh-limine` 自体は対象外。

`refresh-limine` を検索語に GitHub Search API で拾った関連 PR #7998「Timestamp the limine and pacman refresh backups」も直接取得したところ**open・未マージ**（作成/更新は2026-09-28）で、バックアップにタイムスタンプを付けるだけの提案であり、Windows エントリの保持そのものを修正するものではない。

**結論（事実のみ）**: 2026-09-30 時点で、#7867 が報告する2つのバグ（新規ESP作成／`omarchy-refresh-limine`によるWindowsエントリ消失）はどちらも未修正・未マージ。今回の機体が使っている 4.0.4 はこの issue の対象バージョン 4.0.0-1 より新しいが、修正コミットが存在しないため、このバージョン差では直っていないと考えられる。[根拠: PRが2件とも open のまま]

### 1-5. 同種の過去 issue（直接取得、原文抜粋）

- **#4579**（open、2026-02-11作成〜2026-08-23更新、AMD Ryzen 5 5600H機、Windows on SSD + Omarchy on 別HDD）:
  > After completing the Omarchy installation (targeting the HDD partition), the system no longer presents a boot menu ... The "Windows 11" entry is missing from Limine.
  これは別ディスク構成でも同系統の症状が出ることを示す。

- **#1401**（**closed**、2025-09-01作成、`omarchy-online.iso` 使用、別ドライブへのインストールで Windows エントリが消えた事例）:
  > One problem I encountered was that I had an existing Windows 11 installation on one hard drive, after installing from `omarchy-online.iso` to a different hard drive, the Windows boot entry was wiped.
  この issue は closed だが、公式の修正が入った形跡はコメント本文になく、報告者自身が書いた個人 dotfiles リポジトリのガイド（`jackos/dotfiles`）へのリンクが解決策として提示されている。つまり「closed」は「コミュニティのワークアラウンドで各自対応した」であり、「製品側が直した」ではない。[この個人リポジトリの中身までは未検証]

- **#7515**（open、2026-08-19作成〜2026-09-27更新、Omarchy 4.0.0）: free-space install がディスク上に別の非OSパーティション（NTFS データ領域）がある場合に "Creating Btrfs filesystem and subvolumes" で失敗する事例。原文:
  > When a disk has some data partition ... and someone tries to install Omarchy 4 alongside this partition, it will fail on "Creating Btrfs filesystem and subvolumes" ... If I'll create some dummy EFI partition ... it will actually work.
  回避策として「ダミーのEFIパーティションを事前に手動作成しておく」ことでインストーラが通るようになったと報告されている。

### 1-6. 公式マニュアルの dual-boot-install ページ（直接取得、原文全文）

URL: https://omarchy.org/manual/dual-boot-install/

> You're able to install Omarchy to a single partition alongside Windows or other installations.
> This installation method still comes with LUKS encryption for the partition by default so it's effectively no different than full drive and simply requires free space to be available on the disk.
>
> **Making Space on Windows**
> To install alongside Windows, type disk management in the start menu and select the option for Create and format hard disk partitions. Find the appropriate partition, right click, and choose Shrink Volume. Input the amount you'd like to shrink the volume by. Note that this will be the size of your future Omarchy install inclusive of the boot partition.
>
> **Installing Omarchy**
> The install process for Omarchy is effectively the same as normal. After you select your disk, you'll be given the option of Free space install. Select that option to prevent wiping the full disk. Confirm that everything looks good and wait for the install to finish like normal.
>
> **Adding Other Installs to the Bootloader**
> When you finish your Omarchy install, you'll notice that the Limine bootloader is the default now. ... run limine-scan and follow the prompts to add whichever items you'd like to your limine config.
>
> **Bitlocker**
> It's important to note that this install method is not compatible with Bitlocker as it encrypts the entire drive, not just the partition. If you encounter an error stating that Bitlocker is enabled, boot to Windows, go to Settings -> Privacy & Security -> Device encryption and toggle Bitlocker off.

**重要な欠落（否定的事実）**: このページは「Free space install」がインストーラの新規ESP作成なのか既存Windows ESPの再利用なのかについて、一言も説明していない。また Windows のブートエントリは自動追加されず、ユーザーが手動で `limine-scan` を実行する前提になっている（＝ #7867 が報告する「自動では追加されない／自動更新で消える」構造と整合する）。omarchy.org/news の記事一覧（2026-08-14〜2026-09-27、直接取得）にも、この機能に対する修正告知は見当たらない（news は資金調達・人材採用のアナウンスが大半で、dual-boot/ESP関連の変更告知は0件）。

### 1-7. 実践者（named practitioner）による回避策 — GitHub Discussions（直接取得、原文）

vendor 公式手順を信頼せず、手動でパーティション操作をしている例が複数ある。

- **peregrinus879**「Dual boot (on a single SSD)」Discussion #900（open, 2025-08-18作成、2025-09-14編集）:
  > As 'archinstall' and 'omarchy' ISOs do not currently support "pre-mount" partitioning option with LUKS encryption, this is what I did to dual boot ArchLinux & Win11 on a single SSD.
  > General: -- BIOS: Secure Boot OFF ...
  GParted で既存の Omarchy 暗号化パーティションを縮小 → gdisk で Windows 用パーティションを手動作成 → limine.conf に手動で chainload エントリを追記、という完全手動フロー。本人談:
  > I'm not a tech person, I just did it out of a need to run both on a single SSD. If anyone has a simpler approach, please let me know.
  **注**: この手順は Secure Boot OFF が前提であり、本機の Secure Boot ON（カスタム鍵）とは前提が異なる。[unverified: Secure Boot ON下でこの手順が動くかは記述なし]

- **CrimsonCompiler**「Guide: Dual boot Omarchy Os with Windows 11」Discussion #2479（closed, 2025-10-16作成, Omarchy 3.0.2 時点）:
  公式インストーラの「Free space install」を使わず、archinstall の "Pre mounted" ディスク構成を使い、**Windows用ESPとは別に自分で1GBのEFIパーティションを新規作成**してから Omarchy をインストールする手順を提示。本人談:
  > A comprehensive guide for newbie arch users ... You need to stop when it shows your whole nvme ssd. Don't go any further. If you go and do something you might lose your everything.
  この「別のESPを自分で作る」やり方は、結果的に #7867 が問題視する「新規ESP作成」と同じ状態を意図的に作っている点で、公式フローの不具合を前提にした回避策になっている。

---

## 2. 同一ディスク dual boot の実例・失敗例（issue/discussion/Reddit等）

1-3, 1-5, 1-7 で挙げた事例が該当する。追加で:

- #7867 のコメント（one-media-asia）は「HDDに複数のLinuxディストリ + Windows」という混在環境で、Omarchyインストール後に**Windowsだけでなく他のLinuxディストリのブートエントリも失われた**事例であり、被害が Windows に限らないことを示す。
- ArchWiki の Secure Boot ページ（3節、直接取得）に "3.1.8 Dual booting with Microsoft Windows" という節があるが、原文には:
  > This article or section needs expansion. Reason: Is it possible to boot Windows by signing its boot loader with a custom key? (Discuss in Talk:...)
  とあり、**ArchWiki自身が「カスタム鍵でWindowsブートローダーに署名してSecure Boot経由で起動できるか」を未解決の疑問として扱っている**（要拡充マーク）。ただし本機の構成（`sbctl enroll-keys -m` で Microsoft 鍵も併存）は「bootmgfw.efi に独自署名を追加する」方式ではなく「Microsoft自身の鍵をそのままUEFIのdb/KEKに登録する」方式であり、ArchWikiのこの節が扱う問題（二重署名でfirmwareが弾く問題）とは別の話である点に注意。ArchWiki本文（直接取得、原文）:
  > It is usually not possible to boot Windows by signing its boot loader (EFI/Microsoft/Boot/bootmgfw.efi) with a custom, personal key with Secure Boot Mode enabled, without enrolling the "Microsoft Windows Production PCA 2011" key in the UEFI Secure Boot variables

- BitLocker との非互換性は vendor 公式マニュアル（1-6節）が明記済み。今回の機体は「大事なデータは無い」前提でBitLockerは使っていないと想定されるが、Windows 11 は近年 BitLocker（デバイス暗号化）をデフォルトで自動有効化するケースがある。[この機体で実際にBitLockerが有効かどうかは今回未確認 — 本調査の範囲外]

---

## 3. Secure Boot（sbctl カスタム鍵）を入れ直すときの注意

### 3-1. 鍵の格納場所とバックアップ/持ち越しの可否（直接取得、原文）

sbctl の man page（Arch Linux 公式、`man.archlinux.org/man/sbctl.8`、直接取得）:
> **import-keys** — Imports existing keys into sbctl.
> --directory PATH — Path to a key directory. The expected file locations inside this directory are:
> • PK/PK.key • PK/PK.pem • KEK/KEK.key • KEK/KEK.pem • db/db.key • db/db.pem
> --force — Overwrite the existing key directory used by sbctl.

sbctl の README（GitHub、`Foxboron/sbctl`、直接取得）でも `import-keys` コマンドが `sbctl` のトップレベルコマンド一覧に存在することを確認。README 自体には `/var/lib/sbctl` という具体的パスの記載は無かった（README内で明示的パス言及はゼロ、コマンド一覧のみ）。WebSearch要約（未直接検証、複数の二次情報源: Void Linux man, ArchWiki等の要約）によれば:
> The `create-keys` command creates the key hierarchy needed for secure boot into "/var/lib/sbctl/keys" ... Default sbctl key locations include `/var/lib/sbctl/keys/db/db.key` and `/var/lib/sbctl/keys/db/db.pem`
[この具体的パスはWebSearchの要約結果であり、当該man pageページを直接開いてこの一行を原文確認してはいない。man.archlinux.org側の直接取得ではパス表記そのものには到達していない]

**事実として言えること**:
- sbctl には「既存の鍵ディレクトリ（PK/KEK/db の鍵ペア）を新しいインストールに取り込む」ための `import-keys --directory` コマンドが公式に存在する（man page で直接確認）。
- したがって、再インストール前に鍵ディレクトリをバックアップし、新しい Omarchy 環境で `sbctl import-keys --directory <backup>` すれば**同じ鍵ペアを再利用できる**、という経路が sbctl の設計上は用意されている。
- ただし「UEFIファームウェア側にすでに登録済みの鍵(PK/KEK/db)を再度enrollし直す必要があるか」については、sbctl の man page / README のどちらにも明示的な記述は見つからなかった。一般論として、UEFI NVRAM側の鍵（enrolled keys）とディスク上の秘密鍵ファイルは別物であり、ディスクを入れ替えてOSを再インストールしてもUEFI NVRAMの内容（ファームウェアが保持するenrolled keys）は消えないはずだが、これは sbctl のドキュメントによる裏付けではなく一般的なUEFI仕様の理解に基づく **[unverified]**。

### 3-2. Microsoft鍵との併存について

ArchWiki Secure Boot ページ（直接取得）の「Dual booting with Microsoft Windows」節に、KEK/dbへのMicrosoft証明書追加の必要性について記載がある（2節に引用済み）。この一般論は「カスタムPK + Microsoft鍵をdb/KEKに追加登録する」構成（`sbctl enroll-keys -m` が行うこと）と整合的である。

### 3-3. Vanguard（Riot Games）への影響

Riot Games公式サポートページ「Secure Boot」（`support.riotgames.com/en-us/riot/client/secure-boot-guide`、直接取得、著者名 "Wolf"、最終更新 2026-05-30 と本文に表記）:
> Secure Boot is a security feature built into modern PCs ... Some games and applications require Secure Boot to be enabled in order to run properly.
> **Secure Boot is grayed out or won't turn on?** You might have corrupted or outdated Secure Boot keys. We need to restore the factory defaults. ... Select Restore Factory Keys (may also be called Install Default Secure Boot Keys or Reset to Setup Mode).
> If you're seeing VAN: STATUS_SB_POLICY specifically, see the "Secure Boot is grayed out" section above to reset your keys to factory defaults.

**否定的事実（重要）**: このRiot公式ガイドは終始「Windows標準のSecure Boot（工場出荷時のMicrosoft鍵）」を前提にしており、カスタム鍵（sbctlで作った独自PK + Microsoft鍵併存という構成）を許容するかどうかについて**一言も言及していない**。むしろ「Secure Bootでエラーが出たらまず工場出荷時の鍵に戻せ」という指示になっており、カスタム鍵構成はRiotのサポートフローの外側にある。この機体では現に Vanguard が動いている（ユーザー申告）ため実運用上は問題が起きていないと見えるが、これは vendor が公式に保証している状態ではなく、経験的に動いている状態に過ぎない。**[Vanguardがカスタム鍵構成を継続して許容するかどうかの vendor 保証は存在しない]**

---

## 4. Windows側のパーティション縮小

### 4-1. Microsoft公式ドキュメント（直接取得、原文）

URL: https://learn.microsoft.com/en-us/windows-server/storage/disk-management/shrink-a-basic-volume
（Windows 11 / Windows Server 2016-2025 に適用と明記）

> You can decrease the space used by primary partitions and logical drives by shrinking them into adjacent, contiguous space on the same disk. ... Certain file types can block the shrink operation.
>
> **shrink** — Shrinks the volume that has the focus, to create unallocated space. No data loss occurs. **If the partition includes unmovable files, such as the page file or the shadow copy storage area, the volume shrinks to the point where the unmovable files are located.**
>
> **Other considerations**
> When you shrink a partition, certain files like the paging file or the shadow copy storage area can't be automatically relocated. ... If the shrink operation fails, ... Check the application log for an event with ID 259. ... use the fsutil command with the querycluster parameter ...
> In some cases, you can relocate the file temporarily. For example, ... you can use Control Panel to move the paging file or stored shadow copies to another disk. Then you can delete the stored shadow copies, shrink the volume, and move the paging file back to the disk.

**ヒバネーションファイル(hiberfil.sys)についての言及はこの公式ページには無かった**（直接取得で確認、原文中に"hibernat"という語自体が出てこない）。ヒバネーションを無効化する回避策（`powercfg /hibernate off`）は WebSearch 要約で複数のMicrosoft Q&A（ユーザー投稿のフォーラム、`learn.microsoft.com/en-us/answers/...`）や非公式のパーティション管理ツールベンダーのブログ（diskpart.com, resize-c.com等）に見られたが、**これらはMicrosoftの一次ドキュメントではなくコミュニティ投稿/商用ツールベンダーの記事であり、要約経由・未直接検証**。

### 4-2. 回復パーティションの位置（直接取得、原文）

URL: https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/configure-uefigpt-based-hard-drive-partitions

> **Other utility partitions** — Any other utility partitions not managed by Windows must be located before the Windows, data, and recovery image partitions. This allows end users to perform actions such as resizing the Windows partition without affecting system utilities.

この記述から、Microsoft自身の設計指針として「ユーティリティパーティションはWindows/データ/回復パーティションより前に置く」＝回復パーティション(Recovery)はWindowsパーティションの**後ろ**に置く前提であることが読み取れる。WebSearch要約（未直接検証、`learn.microsoft.com/en-us/answers/...` のQ&Aスレッド複数）では:
> In the last few years the recovery partition is being placed at the end of the C partition ...

という記述もあった。これが事実なら、Cドライブを縮小して生まれる未割り当て領域は物理ディスクの末尾ではなく「Cドライブと回復パーティションの間」に挟まれた領域になる。これは Issue #7515（1-5節、非OSパーティションに隣接した空き領域へのインストールが失敗する）の症状と構造的に同じ状況を生みうる **[この機体で実際の回復パーティション位置は未確認、一般論としての整合性の指摘にとどまる]**。

---

## 5. マザーボードの M.2 スロット数（別案の事実）

ASUS公式 Tech Specs ページ（`www.asus.com/us/motherboards-components/motherboards/prime/prime-z690-p/techspec/`、直接取得、原文）:

> Total supports 3 x M.2 slots and 4 x SATA 6Gb/s ports*
> **Intel® Core™ Processors (14th & 13th & 12th Gen)**
> M.2_1 slot (Key M), type 2242/2260/2280/22110 (supports PCIe 4.0 x4 mode)
> **Intel® Z690 Chipset**
> M.2_2 slot (Key M), type 2242/2260/2280 (supports PCIe 4.0 x4 mode)
> M.2_3 slot (Key M), type 2242/2260/2280/22110 (supports PCIe 4.0 x4 & SATA modes)
> 4 x SATA 6Gb/s ports
> * Intel® Rapid Storage Technology supports NVMe RAID 0/1/5, SATA RAID 0/1/5/10.

M.2_3 は "PCIe 4.0 x4 & SATA modes" と明記されており、この点はSATAポートとの排他共有が起きる可能性を示唆する（具体的にどのSATAポートと排他かはこのテックスペックページには記載がなく、マニュアル本体（PDF）の該当図の直接確認はしていない）。事実として: 本機のCPU（i9-12900K = 12th Gen）はM.2_1(CPU直結)を使用中と想定され、M.2_2 または M.2_3 を2本目のNVMe用に使うことは物理的に可能（スロット自体は空いている前提。[この機体の現在の物理占有状況、すなわちM.2_2/3が既に何か使われていないかは未確認]）。2本目のNVMeを追加してOmarchyを別ディスクに置く案は、今回調べた「同一ディスクに詰める」案とは異なり、#7867系のESP競合バグを原理的に回避できる（ESPが物理的に別ディスク上に独立して存在するため）が、これは推測であり、この設定固有の issue 報告は見つからなかった。[no precedent found]

---

## 6. HDDを分割してWindows/Linuxで使う場合のファイルシステム

### 6-1. ntfs3（直接取得、原文）

ArchWiki「NTFS」ページ（`wiki.archlinux.org/title/NTFS`、直接取得、最終更新2026-08-31と本文表記）:

> Linux has two kernel drivers for NTFS with both read and write support:
> **ntfs3**—originally upstreamed to the Linux kernel by Paragon. There are no userspace utilities alongside the ntfs3 kernel driver. To format partitions and perform maintenance, you can install the ntfsprogs package from NTFS-3G or use a Windows machine.
> **ntfs**—available since Linux 7.1 and based on the old (mostly) read-only driver that was removed in Linux 6.9. ...
> There is no objectively better driver at the moment, both have pros and cons ... Notably: ntfs is supposed to have slightly better performance overall. Differences in TRIM implementation.
>
> **Known issues**
> On kernels before 7.1, by default NTFS partitions may mount read-only or fail to mount completely. In such case you need to explicitly specify the file system type as ntfs3.
>
> **Troubleshooting**
> ntfs3 will not mount a partition where the volume is marked dirty without the force option.

ntfs3はカーネル内蔵ドライバとして読み書き両対応であることが確認できる一方、フォーマット・修復用のユーザースペースツールはntfs3自体には付属せず、NTFS-3G由来の`ntfsprogs`が必要という制約が明記されている。

### 6-2. exFAT

ArchWikiの「Exfat」という単独ページは**存在しない**（直接取得したところ404、"There is currently no text in this page"の表示を確認）。exFATの技術情報は「File systems」ページ等の別ページに統合されている可能性があるが、今回は個別ページを深追いしていない。**[exFATのLinuxカーネルドライバの現行の状態について、vendor一次情報の直接確認は今回できていない]**

---

## サマリー表

| 項目 | 出典 | 種別 | 結果/数値 | 費用/コスト | 既知の失敗モード |
|---|---|---|---|---|---|
| 同一ディスクdual bootのESP競合バグ | [omacom/omarchy#7867](https://github.com/omacom/omarchy/issues/7867) | issue(直接取得) | open, 3コメント, 未修正 | なし | 新規ESP作成でWindowsがブートメニューから消える |
| 上記の修正PR | [#6847](https://github.com/omacom/omarchy/pull/6847), [#7998](https://github.com/omacom/omarchy/pull/7998) | PR(直接取得) | 両方open・未マージ | なし | 未マージのため実運用に反映されていない |
| 別ディスクdual bootでも同系統症状 | [#4579](https://github.com/omacom/omarchy/issues/4579) | issue(直接取得) | open | なし | Windowsエントリ消失 |
| `omarchy-online.iso`でも同種消失 | [#1401](https://github.com/omacom/omarchy/issues/1401)(closed) | issue(直接取得) | closed だが公式修正なし、個人ガイドで対応 | なし | ブートエントリ消失 |
| 非OSパーティション隣接での自由領域インストール失敗 | [#7515](https://github.com/omacom/omarchy/issues/7515) | issue(直接取得) | open | なし | Btrfs作成失敗、ダミーESPで回避 |
| 公式マニュアルのdual-boot手順 | [omarchy.org/manual/dual-boot-install/](https://omarchy.org/manual/dual-boot-install/) | vendor doc(直接取得) | 手順あり、ESP再利用/新規作成の挙動は無記載 | なし | BitLocker非互換と明記 |
| sbctl鍵の持ち越し | [sbctl man page](https://man.archlinux.org/man/sbctl.8), [sbctl README](https://github.com/Foxboron/sbctl) | vendor doc(直接取得) | `import-keys --directory`で鍵ディレクトリを取り込み可能 | なし | UEFI NVRAM側の再enroll要否は未記載 |
| Vanguardのカスタム鍵許容 | [Riot Secure Boot guide](https://support.riotgames.com/en-us/riot/client/secure-boot-guide) | vendor doc(直接取得) | カスタム鍵構成への言及なし、エラー時は工場鍵に戻せと指示 | なし | STATUS_SB_POLICYで工場リセットを推奨 |
| Windows側の縮小限界 | [MS Learn: shrink a basic volume](https://learn.microsoft.com/en-us/windows-server/storage/disk-management/shrink-a-basic-volume) | vendor doc(直接取得) | ページファイル/シャドウコピーで縮小上限が決まる | なし | Event ID 259で特定 |
| 回復パーティションの配置指針 | [MS Learn: UEFI/GPT partitions](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/configure-uefigpt-based-hard-drive-partitions) | vendor doc(直接取得) | ユーティリティ領域はWindows/回復領域より前に置く設計指針 | なし | 縮小後の空き領域が回復パーティションに挟まれうる |
| M.2スロット数 | [ASUS techspec](https://www.asus.com/us/motherboards-components/motherboards/prime/prime-z690-p/techspec/) | vendor doc(直接取得) | 3スロット(M.2_1/2/3)、M.2_3はSATA共有 | なし | 排他共有の詳細図は未確認 |
| ntfs3の状態 | [ArchWiki NTFS](https://wiki.archlinux.org/title/NTFS) | vendor/wiki doc(直接取得) | カーネル内蔵、読み書き両対応 | なし | dirtyフラグ時はforce必須 |
| 手動dual boot実践例(Secure Boot OFF前提) | [Discussion #900](https://github.com/omacom/omarchy/discussions/900) | practitioner(直接取得) | GParted+gdiskで手動、成功 | なし | mkfs.ntfs -fでWin11がクラッシュ |
| 手動dual boot実践例(別ESP自作) | [Discussion #2479](https://github.com/omacom/omarchy/discussions/2479) | practitioner(直接取得) | archinstall pre-mountedで成功 | なし | 公式free-space installを意図的に回避 |

---

## 一言でいうと何が言えて何が言えないか

- **言える**: 公式インストーラの「同一ディスクへのdual boot free-space install」は、2026-08時点で報告され2026-09-27時点でも未修正の、複数ハードウェア（NVMe機、SATA機、Apple UEFI機）で独立に再現された2つのバグ（新規ESP作成／`omarchy-refresh-limine`によるWindowsエントリ消失）を抱えている。修正提案PRは2件とも存在するが、どちらも未マージ。
- **言える**: sbctlには鍵ディレクトリを新環境に取り込む`import-keys`という公式コマンドがあり、鍵を作り直さずに再利用する経路は用意されている。
- **言えない**: Vanguard（Riot Games）がこの機体のようなカスタムPK+Microsoft鍵併存構成を継続して許容するという vendor 側の保証。公式ガイドはこの構成そのものに触れていない。
- **言えない**: 回復パーティションの位置がこの機体で実際にどこにあるか（一般的な設計指針からの推測のみ）。
- **確認できなかった**: exFATの現行Linuxドライバの詳細（ArchWiki該当ページが存在しない）。sbctl鍵の具体的な格納パス`/var/lib/sbctl`の一次資料での直接確認（要約経由の情報のみ）。ヒバネーションファイルがshrink上限に影響するという情報のMicrosoft公式一次文書での直接確認（コミュニティQ&Aのみ確認）。UEFI NVRAM上のenrolled keysがOS再インストールをまたいで保持されるかどうかのsbctl自体による明記。

## 確認できなかったこと（no precedent found を含む一覧）

1. Omarchy 4.0.4（本機が導入したバージョン）での#7867の再現有無そのもの — バージョン固有の再テスト報告は見つからなかった（修正PR未マージという事実からの推測に留まる）。
2. sbctlの鍵ファイルの正確な格納パス（`/var/lib/sbctl`か`/usr/share/secureboot`か）の一次資料での直接確認。README/man pageのどちらにも具体的パス文字列は出てこなかった。
3. UEFI NVRAMの enrolled keys がディスク入れ替え・OS再インストールをまたいで保持されるかどうかの sbctl 公式説明。
4. Vanguard が「カスタムPK + Microsoft KEK/db併存」構成を明示的にサポート対象とする vendor 記述。見つからなかった。
5. exFATのLinuxカーネルドライバの現行状態に関するvendor一次情報（ArchWiki該当ページ不在、他ソースは未追跡）。
6. この機体（ASUS PRIME Z690-P）のM.2_2/M.2_3スロットが現在物理的に空いているかどうかの実機確認（今回はスロット総数の仕様確認のみ）。
7. Windows 11でこの機体上のBitLocker（デバイス暗号化）が実際に有効かどうか。
8. 回復パーティションがこの機体上で実際にCドライブの直後に位置しているかどうかの実機確認。
9. 「NVMeをWindows 500GB/Omarchy 500GBに分割」という具体的シナリオでの成功/失敗の実例報告（issue/discussion/blog）はどれも見つからなかった。見つかった実例はすべて「Omarchyを先にフルディスクインストールし、後からWindows用に縮小する」逆順、または「別ディスク」の組み合わせであり、「Windowsが先に入っていて、そこに後からOmarchyを同居させる」という今回とまったく同じ順序・同じ台数構成（NVMe1本を分割）の一次報告は確認できなかった。
