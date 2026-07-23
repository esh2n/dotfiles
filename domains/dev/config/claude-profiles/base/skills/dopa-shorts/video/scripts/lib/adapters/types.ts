import type { SpeechInterval } from "../../../src/schema";

export interface SynthesisResult {
  wav: Buffer;
  durationSec: number;
  /** 発話区間(秒)。取れないエンジンはundefined → wav全長で近似される */
  speech?: SpeechInterval[];
}

export interface VoiceAdapter {
  name: string;
  /** 利用可能ならtrue、不可なら理由(ユーザーへの復旧手順を含む)を返す */
  available(): Promise<true | string>;
  synthesize(text: string, opts: { speaker: string; speed: number }): Promise<SynthesisResult>;
}
