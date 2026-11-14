export const SCENES = [
  { id: "classroom", label: "放课之后", kind: "indoor", thumb: "thumb-class" },
  { id: "dusk", label: "晚归灯火", kind: "outdoor", thumb: "thumb-dusk" },
  { id: "sakura", label: "花影随流", kind: "outdoor", thumb: "thumb-sakura" },
  { id: "bamboo", label: "风过竹间", kind: "outdoor", thumb: "thumb-bamboo" },
  { id: "kyoto", label: "朱影寻春", kind: "outdoor", thumb: "thumb-kyoto" },
  { id: "sea", label: "海风来信", kind: "outdoor", thumb: "thumb-sea" }
];

export function SceneBackdrop({ scene = "classroom", variant = "full" }) {
  if (variant === "ice") {
    return (
      <div className="scene scene-ice" aria-hidden="true">
        <div className="orb o1" /><div className="orb o2" /><div className="orb o3" />
      </div>
    );
  }
  if (scene === "classroom") {
    return (
      <div className="scene scene-classroom" aria-hidden="true">
        <div className="sky"><div className="cloud c1" /><div className="cloud c2" /><div className="sun" /></div>
        <div className="window-wall" />
        <div className="board-left"><i /></div>
        <div className="windows"><div className="win" /><div className="win" /><div className="win" /></div>
        <div className="sill" /><div className="clock" /><div className="rays" />
        <div className="floor" /><div className="floor-light" />
        <div className="desk d1" /><div className="desk d2" /><div className="desk d3" />
      </div>
    );
  }
  if (scene === "sakura") {
    return (
      <div className="scene scene-sakura" aria-hidden="true">
        <div className="petal" style={{ left: "12%" }} />
        <div className="petal" style={{ left: "40%", animationDelay: "2s", background: "#f8c8d6" }} />
        <div className="petal" style={{ left: "68%", animationDelay: "4s" }} />
        <div className="petal" style={{ left: "28%", animationDelay: "6s", background: "#ffe0e8" }} />
      </div>
    );
  }
  const cls = { dusk: "scene-dusk", bamboo: "scene-bamboo", kyoto: "scene-kyoto", sea: "scene-sea" }[scene] || "scene-ice";
  return <div className={`scene ${cls}`} aria-hidden="true" />;
}
