export function Icon({ name, size = 20 }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    companion: <><circle cx="12" cy="8" r="3.2"/><path d="M5 19c1.2-3.2 3.6-5 7-5s5.8 1.8 7 5"/></>,
    chat: <path d="M5 6h14v10H8l-3 3V6z"/>,
    characters: <><circle cx="9" cy="9" r="2.4"/><circle cx="16" cy="10" r="2"/><path d="M4.5 17c.8-2 2.4-3 4.5-3s3.7 1 4.5 3M14 16.5c.6-1.2 1.6-1.8 3-1.8 1.2 0 2.2.5 2.8 1.6"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    send: <path d="M5 12h14M13 6l6 6-6 6"/>,
    mic: <><rect x="9" y="4" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3"/></>,
    camera: <><path d="M4 8h3l2-2h6l2 2h3v12H4z"/><circle cx="12" cy="13" r="3.2"/></>
  };
  return <svg {...common}>{paths[name]}</svg>;
}
