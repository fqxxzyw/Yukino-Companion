import { OUTFIT_LABELS } from "../model/characterModelConfig.js";

const SWATCH = {
  kimono: "outfit-kimono",
  "summer-uniform": "outfit-summer",
  swimsuit: "outfit-swim",
  "black-qipao": "outfit-qipao",
  "twin-tail": "outfit-twin",
  beret: "outfit-beret"
};

export function OutfitPicker({ outfits, value, onChange, title = "形象与服装" }) {
  if (!outfits?.length) return null;
  return (
    <div className="outfit-block">
      <div className="section-kicker">{title}</div>
      <div className="outfit-grid">
        {outfits.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`outfit-tile glass ${SWATCH[item.id] || ""}${item.id === value ? " on" : ""}`}
            onClick={() => onChange(item.id)}
          >
            <span className="outfit-swatch" aria-hidden="true" />
            <b>{item.label || OUTFIT_LABELS[item.id] || item.id}</b>
          </button>
        ))}
      </div>
    </div>
  );
}
