---
title: シーケンス超過テスト
summary: sequence directive がメッセージ上限を超えて steps へフォールバックすることを確認する。
date: 2026-01-17
tags: [test]
---

:::sequence
participant u[ユーザー]
participant s[サーバー]
u -> s : m1
s --> u : m2
u -> s : m3
s --> u : m4
u -> s : m5
s --> u : m6
u -> s : m7
s --> u : m8
u -> s : m9
s --> u : m10
u -> s : m11
s --> u : m12
u -> s : m13
s --> u : m14
u -> s : m15
s --> u : m16
u -> s : m17
:::
