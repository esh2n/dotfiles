import type { Cut } from "../schema";

export type Entrance = "flash-zoom" | "pop" | "slide-up";

/**
 * カット入りの演出をランダムでなく文法ルールで選ぶ:
 * - hook/punch(強遷移): ホワイトフラッシュ+ズーム
 * - SE付きカット: ポップ(叩きつけ)
 * - それ以外(弱遷移): pop / slide-up を交互
 */
export function entranceFor(cut: Cut, index: number): Entrance {
  if (cut.type === "hook" || cut.type === "punch") return "flash-zoom";
  if (cut.se) return "pop";
  return index % 2 === 0 ? "pop" : "slide-up";
}
