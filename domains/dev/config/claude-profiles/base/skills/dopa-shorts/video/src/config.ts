/** 縦動画(9:16)設定 */
export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30,
} as const;

/**
 * セーフエリア: 縦動画は上部にタイトル/検索バー、下部に再生UI・キャプションが
 * 被るため、主要素(テロップ等)は縦中央60%に収める。
 */
export const SAFE_AREA = {
  top: VIDEO.height * 0.2,
  bottom: VIDEO.height * 0.2,
} as const;

export const BGM_VOLUME = {
  normal: 0.28,
  /** セリフ中のダッキング */
  ducked: 0.09,
} as const;
