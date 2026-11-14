import { Icon } from "./icons.jsx";

const TABS = [
  { id: "companion", label: "陪伴" },
  { id: "chat", label: "对话" },
  { id: "characters", label: "角色" },
  { id: "settings", label: "设置" }
];

export function TabBar({ current, onChange }) {
  return (
    <nav className="tabbar glass">
      <span className="sheen" />
      {TABS.map((tab) => (
        <button key={tab.id} className={`tab${current === tab.id ? " active" : ""}`} onClick={() => onChange(tab.id)}>
          <Icon name={tab.id} />
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
