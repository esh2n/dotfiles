import { useMemo } from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/MPLUSRounded1c";
import type { Script, VoiceManifest } from "./schema";
import { buildTimeline } from "./timeline";
import { KineticTemplate } from "./templates/KineticTemplate";
import { ZundaTemplate } from "./templates/ZundaTemplate";

const { fontFamily } = loadFont("normal", {
  weights: ["700", "900"],
  subsets: ["japanese", "latin"],
});

// Remotionの<Composition>はRecord<string, unknown>互換のpropsを要求するため
// interfaceではなくtypeで定義する(interfaceは暗黙のindex signatureを持たない)
export type MainProps = {
  script: Script;
  voices: VoiceManifest | null;
};

export const Main: React.FC<MainProps> = ({ script, voices }) => {
  const { fps } = useVideoConfig();
  const timeline = useMemo(() => buildTimeline(script, voices, fps), [script, voices, fps]);

  const Template = script.meta.style === "kinetic" ? KineticTemplate : ZundaTemplate;

  return (
    <AbsoluteFill style={{ fontFamily }}>
      <Template script={script} timeline={timeline} voices={voices} />
    </AbsoluteFill>
  );
};
