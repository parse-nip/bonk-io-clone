import "./styles.css";
import {
  COLOR_PALETTE,
  DEFAULT_SKIN,
  TEAM_COLORS,
  type GameMode,
  type PlayerProfile,
  type RoomConfig,
  type Screen,
  type Skin,
} from "./types";
import { MAPS, getMap, mapsForMode } from "./game/maps";
import { BonkEngine } from "./game/engine";
import { GameRenderer } from "./game/renderer";
import { InputManager } from "./game/input";
import { botThink } from "./game/ai";

const BOT_NAMES = [
  "bonkBot",
  "Yeeter",
  "HeavyHands",
  "EdgeLord",
  "SpinDoctor",
  "GrappleGod",
  "ArrowKid",
  "ChazFan",
];

interface AppState {
  screen: Screen;
  profile: PlayerProfile;
  room: RoomConfig;
  lobbyPlayers: PlayerProfile[];
  localTwoPlayer: boolean;
  settings: { mute: boolean; showNames: boolean };
}

const saved = localStorage.getItem("bonk-clone-skin");
const startSkin: Skin = saved ? JSON.parse(saved) : { ...DEFAULT_SKIN };

const state: AppState = {
  screen: "login",
  profile: {
    id: "local",
    name: "Guest",
    guest: true,
    skin: startSkin,
    wins: 0,
    team: 1,
    ready: true,
  },
  room: {
    name: "Custom Game",
    mode: "classic",
    mapId: "classic",
    roundsToWin: 3,
    maxPlayers: 6,
    teams: false,
    bots: 3,
  },
  lobbyPlayers: [],
  localTwoPlayer: false,
  settings: { mute: false, showNames: true },
};

const app = document.getElementById("app")!;
let engine: BonkEngine | null = null;
let renderer: GameRenderer | null = null;
let input = new InputManager();
let raf = 0;
let lastTs = 0;
let bannerTimer = 0;
let menuBgEngine: BonkEngine | null = null;
let menuBgRenderer: GameRenderer | null = null;
let chatLines: string[] = [];
let gameEscHandler: ((e: KeyboardEvent) => void) | null = null;

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function setScreen(screen: Screen) {
  state.screen = screen;
  render();
}

function render() {
  stopGameLoop(false);
  app.innerHTML = "";
  const stage = el("div", "stage");
  app.appendChild(stage);

  // always draw a canvas underlay for atmosphere
  const canvas = document.createElement("canvas");
  canvas.className = "game-canvas";
  stage.appendChild(canvas);

  if (state.screen === "game") {
    mountGame(stage, canvas);
    return;
  }

  startMenuBackground(canvas);

  const overlay = el("div", "overlay");
  stage.appendChild(overlay);

  overlay.appendChild(makeTopbar());

  switch (state.screen) {
    case "login":
      overlay.appendChild(makeLogin());
      break;
    case "menu":
      overlay.appendChild(makeMenu());
      break;
    case "quickplay":
      overlay.appendChild(makeQuickPlay());
      break;
    case "rooms":
      overlay.appendChild(makeRooms());
      break;
    case "lobby":
      overlay.appendChild(makeLobby());
      break;
    case "skin":
      overlay.appendChild(makeSkin());
      break;
    case "editor":
      overlay.appendChild(makeEditor());
      break;
    case "settings":
      overlay.appendChild(makeSettings());
      break;
  }
}

function makeTopbar() {
  const bar = el("div", "topbar");
  bar.innerHTML = `
    <div class="brand">bonk.io</div>
    <div class="meta">
      <span>${escapeHtml(state.profile.name)}${state.profile.guest ? " (guest)" : ""}</span>
      <span title="Friends">Friends</span>
      <div class="skin-chip" style="background:${state.profile.skin.baseColor}"></div>
    </div>
  `;
  return bar;
}

function makeLogin() {
  const wrap = el("div", "center-panel panel");
  wrap.innerHTML = `
    <h1>Welcome to Bonk.io!</h1>
    <p style="text-align:center;color:var(--muted);margin-bottom:14px;font-size:13px;line-height:1.4">
      Multiplayer physics game — push opponents off the edge. Last one standing wins.
    </p>
    <div class="field">
      <label>Username</label>
      <input id="name-input" maxlength="16" value="${escapeHtml(state.profile.name === "Guest" ? "" : state.profile.name)}" placeholder="Enter name" />
    </div>
    <div class="row">
      <button class="btn-brown" id="guest-btn">Play as Guest</button>
      <button class="btn-brown" id="login-btn">Login</button>
    </div>
  `;
  queueMicrotask(() => {
    const inputEl = wrap.querySelector<HTMLInputElement>("#name-input")!;
    const go = (guest: boolean) => {
      const name = inputEl.value.trim() || `Guest${Math.floor(Math.random() * 900 + 100)}`;
      state.profile.name = name.slice(0, 16);
      state.profile.guest = guest;
      setScreen("menu");
    };
    wrap.querySelector("#guest-btn")!.addEventListener("click", () => go(true));
    wrap.querySelector("#login-btn")!.addEventListener("click", () => go(false));
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") go(true);
    });
  });
  return wrap;
}

function makeMenu() {
  const frag = document.createDocumentFragment();
  const col = el("div", "menu-column");
  const buttons = [
    ["Quick Play", () => setScreen("quickplay")],
    ["Custom Game", () => setScreen("rooms")],
    ["Skin", () => setScreen("skin")],
    ["Map Editor", () => setScreen("editor")],
    ["Settings", () => setScreen("settings")],
  ] as const;
  for (const [label, fn] of buttons) {
    const b = el("button", "btn-brown") as HTMLButtonElement;
    b.textContent = label;
    b.addEventListener("click", fn);
    col.appendChild(b);
  }
  frag.appendChild(col);

  const foot = el("div", "brand-foot");
  foot.innerHTML = `<div class="presents">Clone presents</div><div class="logo">bonk.io</div>`;
  frag.appendChild(foot);

  const left = el("div", "corner-actions left");
  const exit = el("button", "btn-brown small") as HTMLButtonElement;
  exit.textContent = "Exit Game";
  exit.addEventListener("click", () => setScreen("login"));
  left.appendChild(exit);
  frag.appendChild(left);

  return frag;
}

function makeQuickPlay() {
  const wrap = el("div", "center-panel panel");
  wrap.style.width = "min(560px, 94%)";
  wrap.innerHTML = `
    <h2>Quick Play</h2>
    <div class="mode-cards" id="modes"></div>
    <div class="field">
      <label>Bots in match</label>
      <input type="range" id="bots" min="1" max="7" value="${state.room.bots}" />
      <span id="bots-val">${state.room.bots}</span>
    </div>
    <label style="display:flex;gap:8px;align-items:center;justify-content:center;margin:8px 0;font-size:13px;color:var(--muted)">
      <input type="checkbox" id="two-p" ${state.localTwoPlayer ? "checked" : ""}/>
      Local player 2 (WASD + C heavy + V special)
    </label>
    <div class="row">
      <button class="btn-brown" id="back">Back</button>
      <button class="btn-brown" id="go">Play</button>
    </div>
  `;
  queueMicrotask(() => {
    const modes = wrap.querySelector("#modes")!;
    const modeInfo: { id: GameMode; title: string; desc: string }[] = [
      {
        id: "classic",
        title: "Classic",
        desc: "The original Quick Play. Knock foes off. Hold X to go heavy.",
      },
      {
        id: "arrows",
        title: "Arrows",
        desc: "Hold Z to charge & aim arrows. You can't strafe while aiming!",
      },
      {
        id: "grapple",
        title: "Grapple",
        desc: "Hold Z to swing. Get touched while grappling and you're knocked off.",
      },
    ];
    for (const m of modeInfo) {
      const card = el("button", "mode-card") as HTMLButtonElement;
      if (state.room.mode === m.id) card.classList.add("active");
      card.innerHTML = `<h3>${m.title}</h3><p>${m.desc}</p>`;
      card.addEventListener("click", () => {
        state.room.mode = m.id;
        const pool = mapsForMode(m.id);
        state.room.mapId = pool[Math.floor(Math.random() * pool.length)].id;
        wrap.querySelectorAll(".mode-card").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
      });
      modes.appendChild(card);
    }
    const bots = wrap.querySelector<HTMLInputElement>("#bots")!;
    const botsVal = wrap.querySelector("#bots-val")!;
    bots.addEventListener("input", () => {
      state.room.bots = Number(bots.value);
      botsVal.textContent = String(state.room.bots);
    });
    wrap.querySelector<HTMLInputElement>("#two-p")!.addEventListener("change", (e) => {
      state.localTwoPlayer = (e.target as HTMLInputElement).checked;
    });
    wrap.querySelector("#back")!.addEventListener("click", () => setScreen("menu"));
    wrap.querySelector("#go")!.addEventListener("click", () => {
      const pool = mapsForMode(state.room.mode);
      state.room.mapId = pool[Math.floor(Math.random() * pool.length)].id;
      buildLobbyFromQuickPlay();
      startMatchFromLobby();
    });
  });
  return wrap;
}

function makeRooms() {
  const wrap = el("div", "center-panel panel");
  wrap.style.width = "min(620px, 95%)";
  const fakeRooms = [
    { name: "noobs welcome", mode: "classic", players: "4/8", map: "Classic" },
    { name: "ARROW ONLY", mode: "arrows", players: "3/6", map: "Arrow Lane" },
    { name: "grapple tryhards", mode: "grapple", players: "5/8", map: "Orbit" },
    { name: "football 2v2", mode: "football", players: "2/4", map: "Supercar Pitch" },
  ];
  wrap.innerHTML = `
    <h2>Custom Game</h2>
    <div class="room-list" id="list"></div>
    <div style="margin-top:12px" class="row">
      <button class="btn-brown" id="back">Back</button>
      <button class="btn-brown" id="create">Create Room</button>
    </div>
  `;
  queueMicrotask(() => {
    const list = wrap.querySelector("#list")!;
    for (const r of fakeRooms) {
      const row = el("div", "room-row");
      row.innerHTML = `
        <strong>${r.name}</strong>
        <span>${r.mode}</span>
        <span>${r.players}</span>
      `;
      const join = el("button", "btn-brown small") as HTMLButtonElement;
      join.textContent = "Join";
      join.addEventListener("click", () => {
        state.room.mode = r.mode as GameMode;
        state.room.name = r.name;
        state.room.mapId =
          MAPS.find((m) => m.name === r.map)?.id ??
          mapsForMode(r.mode)[0]?.id ??
          "classic";
        state.room.bots = Math.max(1, parseInt(r.players, 10) - 1);
        buildLobbyFromQuickPlay();
        setScreen("lobby");
      });
      row.appendChild(join);
      list.appendChild(row);
    }
    wrap.querySelector("#back")!.addEventListener("click", () => setScreen("menu"));
    wrap.querySelector("#create")!.addEventListener("click", () => {
      state.room.name = `${state.profile.name}'s game`;
      buildLobbyFromQuickPlay();
      setScreen("lobby");
    });
  });
  return wrap;
}

function makeLobby() {
  const wrap = el("div", "lobby-layout");
  const left = el("div", "panel");
  left.innerHTML = `<h3 style="margin-bottom:8px;color:var(--cream)">${escapeHtml(state.room.name)}</h3>`;
  const list = el("div", "player-list");
  left.appendChild(list);

  const right = el("div", "panel");
  const map = getMap(state.room.mapId);
  right.innerHTML = `
    <div class="field">
      <label>Mode</label>
      <select id="mode">
        <option value="classic">Classic</option>
        <option value="arrows">Arrows</option>
        <option value="deatharrows">Death Arrows</option>
        <option value="grapple">Grapple</option>
        <option value="football">Football</option>
      </select>
    </div>
    <div class="field">
      <label>Map</label>
      <select id="map"></select>
    </div>
    <div class="field">
      <label>Rounds to win</label>
      <input id="rounds" type="number" min="1" max="10" value="${state.room.roundsToWin}" />
    </div>
    <div class="field">
      <label>Bots</label>
      <input id="bots" type="number" min="0" max="7" value="${state.room.bots}" />
    </div>
    <p style="font-size:12px;color:var(--muted);margin:8px 0">Map: <strong style="color:var(--cream)">${map.name}</strong> by ${map.author}</p>
    <div class="row">
      <button class="btn-brown small" id="back">Leave</button>
      <button class="btn-brown small" id="ready">Ready</button>
      <button class="btn-brown" id="start">Start</button>
    </div>
  `;

  wrap.appendChild(left);
  wrap.appendChild(right);

  const refreshList = () => {
    list.innerHTML = "";
    for (const p of state.lobbyPlayers) {
      const row = el("div", "player-row");
      row.innerHTML = `
        <div class="dot" style="background:${p.skin.baseColor}"></div>
        <span>${escapeHtml(p.name)}${p.isBot ? " (bot)" : ""}${p.id === state.profile.id ? " (you)" : ""}</span>
        <span style="color:${TEAM_COLORS[p.team]}">${teamLabel(p.team)}</span>
        <span class="ready">${p.ready ? "✓" : ""}</span>
      `;
      list.appendChild(row);
    }
  };

  queueMicrotask(() => {
    const modeSel = right.querySelector<HTMLSelectElement>("#mode")!;
    const mapSel = right.querySelector<HTMLSelectElement>("#map")!;
    modeSel.value = state.room.mode;
    const fillMaps = () => {
      mapSel.innerHTML = "";
      for (const m of MAPS) {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = `${m.name} (${m.author})`;
        mapSel.appendChild(opt);
      }
      mapSel.value = state.room.mapId;
    };
    fillMaps();
    modeSel.addEventListener("change", () => {
      state.room.mode = modeSel.value as GameMode;
      const pool = mapsForMode(state.room.mode);
      if (!pool.find((m) => m.id === state.room.mapId)) {
        state.room.mapId = pool[0]?.id ?? "classic";
      }
      fillMaps();
    });
    mapSel.addEventListener("change", () => {
      state.room.mapId = mapSel.value;
    });
    right.querySelector<HTMLInputElement>("#rounds")!.addEventListener("change", (e) => {
      state.room.roundsToWin = Number((e.target as HTMLInputElement).value) || 3;
    });
    right.querySelector<HTMLInputElement>("#bots")!.addEventListener("change", (e) => {
      state.room.bots = Number((e.target as HTMLInputElement).value) || 0;
      buildLobbyFromQuickPlay();
      refreshList();
    });
    right.querySelector("#back")!.addEventListener("click", () => setScreen("menu"));
    right.querySelector("#ready")!.addEventListener("click", () => {
      const me = state.lobbyPlayers.find((p) => p.id === state.profile.id);
      if (me) me.ready = !me.ready;
      refreshList();
    });
    right.querySelector("#start")!.addEventListener("click", () => startMatchFromLobby());
    refreshList();
  });

  return wrap;
}

function makeSkin() {
  const wrap = el("div", "skin-layout");
  const layers = el("div", "panel");
  layers.innerHTML = `
    <h3 style="color:var(--cream);margin-bottom:8px">Skin</h3>
    <label style="display:flex;gap:8px;align-items:center;margin:6px 0;font-size:13px">
      <input type="checkbox" id="eyes" ${state.profile.skin.eyes ? "checked" : ""}/> Eyes
    </label>
    <label style="display:flex;gap:8px;align-items:center;margin:6px 0;font-size:13px">
      <input type="checkbox" id="mouth" ${state.profile.skin.mouth ? "checked" : ""}/> Mouth
    </label>
    <p style="font-size:12px;color:var(--muted);margin-top:10px">Base colour</p>
    <div class="swatches" id="base"></div>
    <p style="font-size:12px;color:var(--muted);margin-top:10px">Accent</p>
    <div class="swatches" id="accent"></div>
  `;
  const preview = el("div", "panel");
  preview.style.display = "grid";
  preview.style.placeItems = "center";
  const pv = document.createElement("canvas");
  pv.width = 220;
  pv.height = 220;
  preview.appendChild(pv);
  const actions = el("div", "panel");
  actions.innerHTML = `
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px;line-height:1.4">
      Guests can edit skins, but they reset if you clear site data. Save stores locally.
    </p>
    <div class="row">
      <button class="btn-brown" id="cancel">Cancel</button>
      <button class="btn-brown" id="save">Save</button>
    </div>
  `;
  wrap.append(layers, preview, actions);

  const draft: Skin = { ...state.profile.skin };
  const drawPreview = () => {
    const ctx = pv.getContext("2d")!;
    ctx.clearRect(0, 0, 220, 220);
    ctx.fillStyle = "#2c2c2c";
    ctx.fillRect(0, 0, 220, 220);
    const x = 110;
    const y = 110;
    const r = 70;
    ctx.beginPath();
    ctx.fillStyle = draft.baseColor;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(x - 20, y - 20, 5, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (draft.eyes) {
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(x - 18, y - 10, 8, 0, Math.PI * 2);
      ctx.arc(x + 18, y - 10, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(x - 20, y - 12, 2.5, 0, Math.PI * 2);
      ctx.arc(x + 16, y - 12, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (draft.mouth) {
      ctx.strokeStyle = draft.accent;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(x, y + 14, 18, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
  };

  queueMicrotask(() => {
    const fill = (id: string, key: "baseColor" | "accent") => {
      const box = layers.querySelector(`#${id}`)!;
      for (const c of COLOR_PALETTE) {
        const s = el("button", "swatch") as HTMLButtonElement;
        s.style.background = c;
        if (draft[key] === c) s.classList.add("active");
        s.addEventListener("click", () => {
          draft[key] = c;
          box.querySelectorAll(".swatch").forEach((x) => x.classList.remove("active"));
          s.classList.add("active");
          drawPreview();
        });
        box.appendChild(s);
      }
    };
    fill("base", "baseColor");
    fill("accent", "accent");
    layers.querySelector("#eyes")!.addEventListener("change", (e) => {
      draft.eyes = (e.target as HTMLInputElement).checked;
      drawPreview();
    });
    layers.querySelector("#mouth")!.addEventListener("change", (e) => {
      draft.mouth = (e.target as HTMLInputElement).checked;
      drawPreview();
    });
    actions.querySelector("#cancel")!.addEventListener("click", () => setScreen("menu"));
    actions.querySelector("#save")!.addEventListener("click", () => {
      state.profile.skin = { ...draft };
      localStorage.setItem("bonk-clone-skin", JSON.stringify(draft));
      setScreen("menu");
    });
    drawPreview();
  });

  return wrap;
}

function makeEditor() {
  const wrap = el("div", "editor-layout");
  const tools = el("div", "panel");
  tools.innerHTML = `
    <h3 style="color:var(--cream);margin-bottom:8px">Map Editor</h3>
    <p style="font-size:12px;color:var(--muted);line-height:1.4;margin-bottom:10px">
      Simplified editor. Place platforms & spawns, then playtest in Classic.
    </p>
    <div class="field"><label>Name</label><input id="n" value="My Map" /></div>
    <div class="row" style="margin-bottom:8px">
      <button class="btn-brown small" id="box">+ Box</button>
      <button class="btn-brown small" id="circle">+ Circle</button>
      <button class="btn-brown small" id="spawn">+ Spawn</button>
    </div>
    <div class="row">
      <button class="btn-brown small danger" id="clear">Clear</button>
      <button class="btn-brown small" id="play">Playtest</button>
      <button class="btn-brown small" id="back">Back</button>
    </div>
  `;
  const mid = el("div", "panel");
  mid.style.padding = "0";
  mid.style.overflow = "hidden";
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 320;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.cursor = "crosshair";
  mid.appendChild(canvas);
  const props = el("div", "panel");
  props.innerHTML = `<h4 style="color:var(--cream)">Elements</h4><div id="els" style="font-size:12px;margin-top:8px"></div>`;
  wrap.append(tools, mid, props);

  type DraftShape = {
    type: "box" | "circle" | "spawn";
    x: number;
    y: number;
    w: number;
    h: number;
    r: number;
    color: string;
  };
  let tool: "box" | "circle" | "spawn" = "box";
  const shapes: DraftShape[] = [
    { type: "box", x: 240, y: 220, w: 200, h: 28, r: 20, color: "#8fd14f" },
    { type: "spawn", x: 200, y: 160, w: 0, h: 0, r: 8, color: "#e74c3c" },
    { type: "spawn", x: 280, y: 160, w: 0, h: 0, r: 8, color: "#3498db" },
  ];

  const redraw = () => {
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#2c2c2c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const s of shapes) {
      if (s.type === "spawn") {
        ctx.beginPath();
        ctx.fillStyle = s.color;
        ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.fillStyle = s.color;
      if (s.type === "circle") {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(s.x - s.w / 2, s.y - s.h / 2, s.w, s.h);
      }
    }
    const els = props.querySelector("#els")!;
    els.innerHTML = shapes
      .map(
        (s, i) =>
          `<div style="margin:4px 0;padding:4px;background:#222;border-radius:3px">${i + 1}. ${s.type} @ ${Math.round(s.x)},${Math.round(s.y)}</div>`,
      )
      .join("");
  };

  queueMicrotask(() => {
    tools.querySelector("#box")!.addEventListener("click", () => (tool = "box"));
    tools.querySelector("#circle")!.addEventListener("click", () => (tool = "circle"));
    tools.querySelector("#spawn")!.addEventListener("click", () => (tool = "spawn"));
    tools.querySelector("#clear")!.addEventListener("click", () => {
      shapes.length = 0;
      redraw();
    });
    tools.querySelector("#back")!.addEventListener("click", () => setScreen("menu"));
    tools.querySelector("#play")!.addEventListener("click", () => {
      const customId = "custom-editor";
      const existing = MAPS.findIndex((m) => m.id === customId);
      const def = {
        id: customId,
        name: (tools.querySelector("#n") as HTMLInputElement).value || "My Map",
        author: state.profile.name,
        modeHint: "classic" as const,
        width: 780,
        height: 520,
        gravity: { x: 0, y: 1.2 },
        killY: 560,
        killPadding: 50,
        shapes: shapes
          .filter((s) => s.type !== "spawn")
          .map((s) =>
            s.type === "circle"
              ? {
                  type: "circle" as const,
                  x: (s.x / 480) * 780,
                  y: (s.y / 320) * 520,
                  r: s.r * 1.4,
                  color: s.color,
                  static: true,
                }
              : {
                  type: "box" as const,
                  x: (s.x / 480) * 780,
                  y: (s.y / 320) * 520,
                  w: s.w * 1.5,
                  h: s.h * 1.4,
                  color: s.color,
                  static: true,
                },
          ),
        spawns: shapes
          .filter((s) => s.type === "spawn")
          .map((s) => ({
            x: (s.x / 480) * 780,
            y: (s.y / 320) * 520,
          })),
      };
      if (!def.spawns.length) {
        def.spawns = [
          { x: 300, y: 200 },
          { x: 480, y: 200 },
        ];
      }
      if (existing >= 0) MAPS[existing] = def;
      else MAPS.push(def);
      state.room.mapId = customId;
      state.room.mode = "classic";
      state.room.bots = 3;
      buildLobbyFromQuickPlay();
      startMatchFromLobby();
    });
    canvas.addEventListener("click", (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
      if (tool === "box") {
        shapes.push({
          type: "box",
          x,
          y,
          w: 120,
          h: 24,
          r: 20,
          color: COLOR_PALETTE[Math.floor(Math.random() * 8)],
        });
      } else if (tool === "circle") {
        shapes.push({
          type: "circle",
          x,
          y,
          w: 0,
          h: 0,
          r: 36,
          color: COLOR_PALETTE[Math.floor(Math.random() * 8)],
        });
      } else {
        shapes.push({
          type: "spawn",
          x,
          y,
          w: 0,
          h: 0,
          r: 8,
          color: "#e74c3c",
        });
      }
      redraw();
    });
    redraw();
  });

  return wrap;
}

function makeSettings() {
  const wrap = el("div", "center-panel panel");
  wrap.innerHTML = `
    <h2>Settings</h2>
    <label style="display:flex;gap:8px;align-items:center;margin:10px 0;font-size:14px">
      <input type="checkbox" id="mute" ${state.settings.mute ? "checked" : ""}/> Mute (placeholder)
    </label>
    <p style="font-size:13px;color:var(--muted);line-height:1.45;margin:12px 0">
      Controls: Arrow keys move, Up jump, X/Space/Shift heavy, Z/Y special.<br/>
      Player 2: WASD, C heavy, V special.
    </p>
    <div class="row">
      <button class="btn-brown" id="back">Back</button>
    </div>
  `;
  queueMicrotask(() => {
    wrap.querySelector("#mute")!.addEventListener("change", (e) => {
      state.settings.mute = (e.target as HTMLInputElement).checked;
    });
    wrap.querySelector("#back")!.addEventListener("click", () => setScreen("menu"));
  });
  return wrap;
}

function buildLobbyFromQuickPlay() {
  const bots = state.room.bots;
  const players: PlayerProfile[] = [
    {
      ...state.profile,
      ready: true,
      team: state.room.mode === "football" ? 2 : 1,
    },
  ];
  if (state.localTwoPlayer) {
    players.push({
      id: "local2",
      name: "Player2",
      guest: true,
      skin: { ...DEFAULT_SKIN, baseColor: "#3498db" },
      wins: 0,
      team: state.room.mode === "football" ? 3 : 1,
      ready: true,
    });
  }
  for (let i = 0; i < bots; i++) {
    const team =
      state.room.mode === "football" ? (i % 2 === 0 ? 3 : 2) : 1;
    players.push({
      id: uid(),
      name: BOT_NAMES[i % BOT_NAMES.length] + (i > 7 ? String(i) : ""),
      guest: true,
      isBot: true,
      skin: {
        baseColor: COLOR_PALETTE[(i + 3) % COLOR_PALETTE.length],
        eyes: true,
        mouth: true,
        accent: "#222",
      },
      wins: 0,
      team: team as 1 | 2 | 3,
      ready: true,
    });
  }
  state.lobbyPlayers = players.slice(0, state.room.maxPlayers);
}

function startMatchFromLobby() {
  chatLines = [`Room started — ${state.room.mode} on ${getMap(state.room.mapId).name}`];
  setScreen("game");
}

function mountGame(stage: HTMLElement, canvas: HTMLCanvasElement) {
  stopMenuBackground();
  engine = new BonkEngine(state.room.mode, state.room.mapId, state.room.roundsToWin);
  engine.addPlayers(state.lobbyPlayers);
  renderer = new GameRenderer(canvas);
  input.bind();

  const hud = el("div", "hud");
  hud.innerHTML = `
    <div class="scoreboard" id="scoreboard"></div>
    <div class="banner" id="banner"></div>
    <div class="chat" id="chat"></div>
    <div class="controls-hint">Arrows move · X heavy · Z special · Esc menu</div>
    <button class="btn-brown small leave" id="leave">Leave</button>
  `;
  stage.appendChild(hud);

  const banner = hud.querySelector("#banner") as HTMLElement;
  const scoreboard = hud.querySelector("#scoreboard")!;
  const chat = hud.querySelector("#chat")!;

  const refreshScore = () => {
    scoreboard.innerHTML = engine!
      .players.map(
        (p) =>
          `<div class="pill"><div class="ball" style="background:${p.skin.baseColor}"></div>${escapeHtml(p.name)} ${p.wins}</div>`,
      )
      .join("");
    chat.innerHTML = chatLines
      .slice(-6)
      .map((l) => `<div>${escapeHtml(l)}</div>`)
      .join("");
  };

  engine.on((e) => {
    if (e.type === "banner") {
      banner.textContent = e.text;
      banner.classList.add("show");
      bannerTimer = 1.2;
    }
    if (e.type === "eliminated") {
      const victim = engine!.players.find((p) => p.id === e.id);
      chatLines.push(`${victim?.name ?? "player"} fell off!`);
      refreshScore();
    }
    if (e.type === "round_over") {
      refreshScore();
    }
    if (e.type === "goal") {
      chatLines.push(`Goal scored!`);
      refreshScore();
    }
    if (e.type === "match_over") {
      const w = engine!.players.find((p) => p.id === e.winnerId);
      banner.textContent = `${w?.name ?? "Someone"} wins the match!`;
      banner.classList.add("show");
      chatLines.push(`Match over — ${w?.name} wins!`);
      refreshScore();
      setTimeout(() => {
        stopGameLoop(true);
        setScreen("lobby");
      }, 2500);
    }
  });

  hud.querySelector("#leave")!.addEventListener("click", () => {
    stopGameLoop(true);
    setScreen("lobby");
  });

  gameEscHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      stopGameLoop(true);
      setScreen("lobby");
    }
  };
  window.addEventListener("keydown", gameEscHandler);

  engine.startRound();
  refreshScore();
  lastTs = performance.now();
  const loop = (ts: number) => {
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    if (!engine || !renderer) return;

    // inputs
    const me = engine.players.find((p) => p.id === state.profile.id);
    if (me) engine.setInput(me.id, input.primary);
    if (state.localTwoPlayer) {
      const p2 = engine.players.find((p) => p.id === "local2");
      if (p2) engine.setInput(p2.id, input.secondary);
    }
    for (const p of engine.players) {
      if (p.isBot && p.alive) {
        engine.setInput(p.id, botThink(engine, p));
      }
    }

    engine.update(dt);
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) banner.classList.remove("show");
    }
    renderer.draw(engine, state.profile.id);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  window.addEventListener("resize", () => renderer?.resize());
}

function stopGameLoop(destroyEngine: boolean) {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  input.unbind();
  if (gameEscHandler) {
    window.removeEventListener("keydown", gameEscHandler);
    gameEscHandler = null;
  }
  if (destroyEngine && engine) {
    engine.destroy();
    engine = null;
  }
  renderer = null;
}

function startMenuBackground(canvas: HTMLCanvasElement) {
  stopMenuBackground();
  menuBgEngine = new BonkEngine("classic", "classic", 99);
  menuBgEngine.addPlayers([
    {
      id: "a",
      name: "",
      guest: true,
      isBot: true,
      skin: { baseColor: "#e74c3c", eyes: true, mouth: true, accent: "#222" },
      wins: 0,
      team: 1,
      ready: true,
    },
    {
      id: "b",
      name: "",
      guest: true,
      isBot: true,
      skin: { baseColor: "#f1c40f", eyes: true, mouth: true, accent: "#222" },
      wins: 0,
      team: 1,
      ready: true,
    },
    {
      id: "c",
      name: "",
      guest: true,
      isBot: true,
      skin: { baseColor: "#3498db", eyes: true, mouth: true, accent: "#222" },
      wins: 0,
      team: 1,
      ready: true,
    },
  ]);
  menuBgRenderer = new GameRenderer(canvas);
  menuBgEngine.startRound();
  // skip countdown
  menuBgEngine.countdown = 0;
  menuBgEngine.roundActive = true;

  let prev = performance.now();
  const tick = (ts: number) => {
    if (!menuBgEngine || !menuBgRenderer) return;
    const dt = Math.min(0.05, (ts - prev) / 1000);
    prev = ts;
    for (const p of menuBgEngine.players) {
      if (p.alive) menuBgEngine.setInput(p.id, botThink(menuBgEngine, p));
      else {
        // respawn for ambience
        p.alive = true;
        // re-add body if removed
      }
    }
    // keep players alive for ambience — revive
    if (menuBgEngine.players.filter((p) => p.alive).length < 2) {
      menuBgEngine.startRound();
      menuBgEngine.countdown = 0;
      menuBgEngine.roundActive = true;
    }
    menuBgEngine.update(dt);
    menuBgRenderer.draw(menuBgEngine, "");
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function stopMenuBackground() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (menuBgEngine) {
    menuBgEngine.destroy();
    menuBgEngine = null;
  }
  menuBgRenderer = null;
}

function teamLabel(t: number) {
  return ["SPEC", "FFA", "RED", "BLUE", "GREEN", "YELLOW"][t] ?? "FFA";
}

function el(tag: string, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

render();
