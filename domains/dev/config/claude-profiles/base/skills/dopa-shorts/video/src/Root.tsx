import { Composition } from "remotion";
import { VIDEO } from "./config";
import { Main, type MainProps } from "./Main";
import { scriptSchema } from "./schema";
import { buildTimeline } from "./timeline";

/** Studioプレビュー用のデフォルト台本(音声なし・尺は文字数推定) */
const previewScript = scriptSchema.parse({
  meta: { title: "dopa-shorts preview", style: "kinetic" },
  cuts: [
    { type: "hook", text: "この動画、実はコードから生成されてるのだ", telop: "全部コード生成🔥" },
    { type: "body", text: "台本のJSONを書くだけで、音声もテロップも自動なのだ", telop: "台本JSONだけ" },
    { type: "body", text: "口パクはモーラ単位で音声に同期するのだ", se: "pop", telop: "口パク完全同期" },
    { type: "punch", text: "つまり、もう動画編集はいらないのだ", telop: "編集ソフト、卒業" },
  ],
});

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Main"
      component={Main}
      width={VIDEO.width}
      height={VIDEO.height}
      fps={VIDEO.fps}
      durationInFrames={600}
      defaultProps={{ script: previewScript, voices: null } satisfies MainProps}
      calculateMetadata={({ props }) => {
        // --props で渡ってくるJSONをここで必ずバリデーションする
        const script = scriptSchema.parse(props.script);
        const timeline = buildTimeline(script, props.voices ?? null, VIDEO.fps);
        return {
          durationInFrames: timeline.totalFrames,
          props: { ...props, script },
        };
      }}
    />
  );
};
