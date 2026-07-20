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
import { fetchRoomList, NetClient } from "./net/client";
import { SnapshotBuffer } from "./net/interpolate";
import { unpackInput } from "../shared/protocol";
import type { RoomSummary, ServerMessage } from "../shared/protocol";

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
  /** True when connected to a Cloudflare Durable Object room. */
  online: boolean;
  isHost: boolean;
  roomCode: string | null;
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
  online: false,
  isHost: false,
  roomCode: null,
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
let net = new NetClient();
let unsubNet: (() => void) | null = null;
let snapBuffer = new SnapshotBuffer();
let lastBannerFromSnap = "";
let snapSendAcc = 0;
let pendingClientMatchOver: string | null = null;

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
    <div class="brand">bonk</div>
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
    ["Online Multiplayer", () => setScreen("rooms")],
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
  foot.innerHTML = `<div class="presents">popped.dev presents</div><div class="logo">bonk</div>`;
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
  wrap.style.width = "min(640px, 95%)";
  wrap.innerHTML = `
    <h2>Online Multiplayer</h2>
    <p style="text-align:center;color:var(--muted);font-size:12px;margin:-6px 0 12px;line-height:1.4">
      Real-time rooms on Cloudflare Durable Objects · host-authoritative physics
    </p>
    <div class="field">
      <label>Join by room code</label>
      <div class="row" style="margin:0">
        <input id="code" maxlength="8" placeholder="e.g. AB3K9" style="flex:1;text-transform:uppercase" />
        <button class="btn-brown" id="join-code">Join</button>
      </div>
    </div>
    <div class="room-list" id="list"><div style="padding:10px;color:var(--muted);font-size:13px">Loading rooms…</div></div>
    <div style="margin-top:12px" class="row">
      <button class="btn-brown" id="back">Back</button>
      <button class="btn-brown" id="refresh">Refresh</button>
      <button class="btn-brown" id="create">Create Room</button>
      <button class="btn-brown small" id="offline">Local only</button>
    </div>
    <p id="net-status" style="text-align:center;color:var(--muted);font-size:11px;margin-top:10px"></p>
  `;

  const status = () => wrap.querySelector("#net-status") as HTMLElement;
  const listEl = () => wrap.querySelector("#list")!;

  const paintRooms = (rooms: RoomSummary[]) => {
    const list = listEl();
    list.innerHTML = "";
    const open = rooms.filter((r) => !r.inGame);
    if (!open.length) {
      list.innerHTML = `<div style="padding:10px;color:var(--muted);font-size:13px">No open rooms — create one and share the code.</div>`;
      return;
    }
    for (const r of open) {
      const row = el("div", "room-row");
      row.innerHTML = `
        <strong>${escapeHtml(r.name)}</strong>
        <span>${escapeHtml(r.mode)}</span>
        <span>${r.players}/${r.maxPlayers}</span>
        <span style="font-family:monospace">${escapeHtml(r.code)}</span>
      `;
      const join = el("button", "btn-brown small") as HTMLButtonElement;
      join.textContent = "Join";
      join.addEventListener("click", () => void joinOnlineRoom(r.code, status()));
      row.appendChild(join);
      list.appendChild(row);
    }
  };

  const refresh = async () => {
    status().textContent = "Fetching /api/rooms…";
    const rooms = await fetchRoomList();
    paintRooms(rooms);
    status().textContent = rooms.length
      ? `${rooms.length} room(s) listed`
      : "Lobby empty (is wrangler / deploy running?)";
  };

  queueMicrotask(() => {
    void refresh();
    wrap.querySelector("#refresh")!.addEventListener("click", () => void refresh());
    wrap.querySelector("#back")!.addEventListener("click", () => setScreen("menu"));
    wrap.querySelector("#offline")!.addEventListener("click", () => {
      disconnectOnline();
      state.room.name = `${state.profile.name}'s game`;
      state.room.bots = 3;
      buildLobbyFromQuickPlay();
      setScreen("lobby");
    });
    wrap.querySelector("#create")!.addEventListener("click", () => {
      void createOnlineRoom(status());
    });
    wrap.querySelector("#join-code")!.addEventListener("click", () => {
      const code = (wrap.querySelector("#code") as HTMLInputElement).value;
      void joinOnlineRoom(code, status());
    });
    wrap.querySelector("#code")!.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") {
        const code = (wrap.querySelector("#code") as HTMLInputElement).value;
        void joinOnlineRoom(code, status());
      }
    });
  });
  return wrap;
}

async function createOnlineRoom(statusEl?: HTMLElement) {
  try {
    statusEl && (statusEl.textContent = "Creating room…");
    bindNetHandlers();
    state.room.name = `${state.profile.name}'s game`;
    state.room.bots = 0;
    await net.create(state.profile.name, state.profile.guest, state.profile.skin, {
      name: state.room.name,
      mode: state.room.mode,
      mapId: state.room.mapId,
      roundsToWin: state.room.roundsToWin,
      maxPlayers: state.room.maxPlayers,
      teams: state.room.teams,
      bots: 0,
    });
    state.online = true;
    state.isHost = net.isHost;
    state.roomCode = net.code;
    state.localTwoPlayer = false;
    if (net.playerId) state.profile.id = net.playerId;
    setScreen("lobby");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create room";
    statusEl && (statusEl.textContent = msg);
    disconnectOnline();
  }
}

async function joinOnlineRoom(code: string, statusEl?: HTMLElement) {
  if (!code.trim()) {
    statusEl && (statusEl.textContent = "Enter a room code");
    return;
  }
  try {
    statusEl && (statusEl.textContent = `Joining ${code.toUpperCase()}…`);
    bindNetHandlers();
    await net.join(code, state.profile.name, state.profile.guest, state.profile.skin);
    state.online = true;
    state.isHost = net.isHost;
    state.roomCode = net.code;
    state.localTwoPlayer = false;
    state.room.bots = 0;
    if (net.playerId) state.profile.id = net.playerId;
    setScreen("lobby");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to join";
    statusEl && (statusEl.textContent = msg);
    disconnectOnline();
  }
}

function bindNetHandlers() {
  unsubNet?.();
  unsubNet = net.on(handleServerMessage);
}

function disconnectOnline() {
  unsubNet?.();
  unsubNet = null;
  net.disconnect();
  state.online = false;
  state.isHost = false;
  state.roomCode = null;
  snapBuffer.clear();
}

function handleServerMessage(msg: ServerMessage) {
  switch (msg.type) {
    case "welcome":
      state.profile.id = msg.playerId;
      state.roomCode = msg.code;
      state.isHost = msg.isHost;
      break;
    case "lobby":
      state.room = {
        name: msg.room.name,
        mode: msg.room.mode,
        mapId: msg.room.mapId,
        roundsToWin: msg.room.roundsToWin,
        maxPlayers: msg.room.maxPlayers,
        teams: msg.room.teams,
        bots: 0,
      };
      state.isHost = msg.hostId === state.profile.id;
      state.lobbyPlayers = msg.players.map((p) => ({
        id: p.id,
        name: p.name,
        guest: p.guest,
        skin: p.skin,
        wins: p.wins,
        team: p.team as PlayerProfile["team"],
        ready: p.ready,
        isBot: p.isBot,
      }));
      if (state.screen === "lobby") render();
      break;
    case "started":
      state.room = {
        name: msg.room.name,
        mode: msg.room.mode,
        mapId: msg.room.mapId,
        roundsToWin: msg.room.roundsToWin,
        maxPlayers: msg.room.maxPlayers,
        teams: msg.room.teams,
        bots: 0,
      };
      state.lobbyPlayers = msg.players.map((p) => ({
        id: p.id,
        name: p.name,
        guest: p.guest,
        skin: p.skin,
        wins: p.wins,
        team: p.team as PlayerProfile["team"],
        ready: p.ready,
        isBot: p.isBot,
      }));
      snapBuffer.clear();
      lastBannerFromSnap = "";
      pendingClientMatchOver = null;
      chatLines = [`Online match — code ${state.roomCode ?? "????"}`];
      setScreen("game");
      break;
    case "snapshot":
      snapBuffer.push(msg.snap);
      if (msg.snap.event === "match_over") {
        pendingClientMatchOver = msg.snap.eventPlayerId ?? "";
      }
      break;
    case "chat":
      chatLines.push(`${msg.from}: ${msg.text}`);
      break;
    case "host_changed":
      state.isHost = msg.hostId === state.profile.id;
      chatLines.push(state.isHost ? "You are the new host." : "Host changed.");
      if (state.screen === "lobby") render();
      break;
    case "peer_left":
      chatLines.push(`Player left (${msg.playerId.slice(0, 4)}…)`);
      break;
    case "error":
      chatLines.push(`Error: ${msg.message}`);
      if (state.screen === "rooms" || state.screen === "lobby") {
        // surface later via lobby status if needed
      }
      break;
  }
}

function makeLobby() {
  const wrap = el("div", "lobby-layout");
  const left = el("div", "panel");
  const codeLine = state.online && state.roomCode
    ? `<p style="font-size:12px;color:var(--lime);margin-bottom:8px">Room code: <strong style="font-family:monospace;letter-spacing:0.08em">${escapeHtml(state.roomCode)}</strong>${state.isHost ? " · host" : ""}</p>`
    : `<p style="font-size:12px;color:var(--muted);margin-bottom:8px">Local lobby (bots OK)</p>`;
  left.innerHTML = `<h3 style="margin-bottom:8px;color:var(--cream)">${escapeHtml(state.room.name)}</h3>${codeLine}`;
  const list = el("div", "player-list");
  left.appendChild(list);

  const right = el("div", "panel");
  const map = getMap(state.room.mapId);
  const hostOnly = state.online && !state.isHost;
  right.innerHTML = `
    <div class="field">
      <label>Mode</label>
      <select id="mode" ${hostOnly ? "disabled" : ""}>
        <option value="classic">Classic</option>
        <option value="arrows">Arrows</option>
        <option value="deatharrows">Death Arrows</option>
        <option value="grapple">Grapple</option>
        <option value="football">Football</option>
      </select>
    </div>
    <div class="field">
      <label>Map</label>
      <select id="map" ${hostOnly ? "disabled" : ""}></select>
    </div>
    <div class="field">
      <label>Rounds to win</label>
      <input id="rounds" type="number" min="1" max="10" value="${state.room.roundsToWin}" ${hostOnly ? "disabled" : ""} />
    </div>
    ${
      state.online
        ? `<p style="font-size:12px;color:var(--muted);margin:8px 0">Online matches are human-only (host runs physics).</p>`
        : `<div class="field">
      <label>Bots</label>
      <input id="bots" type="number" min="0" max="7" value="${state.room.bots}" />
    </div>`
    }
    <p style="font-size:12px;color:var(--muted);margin:8px 0">Map: <strong style="color:var(--cream)">${map.name}</strong> by ${map.author}</p>
    <div class="row">
      <button class="btn-brown small" id="back">Leave</button>
      <button class="btn-brown small" id="ready">Ready</button>
      <button class="btn-brown" id="start" ${hostOnly ? "disabled" : ""}>Start</button>
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

    const pushConfig = () => {
      if (state.online && state.isHost) {
        net.updateConfig({
          name: state.room.name,
          mode: state.room.mode,
          mapId: state.room.mapId,
          roundsToWin: state.room.roundsToWin,
          maxPlayers: state.room.maxPlayers,
          teams: state.room.teams,
          bots: 0,
        });
      }
    };

    modeSel.addEventListener("change", () => {
      state.room.mode = modeSel.value as GameMode;
      const pool = mapsForMode(state.room.mode);
      if (!pool.find((m) => m.id === state.room.mapId)) {
        state.room.mapId = pool[0]?.id ?? "classic";
      }
      fillMaps();
      pushConfig();
    });
    mapSel.addEventListener("change", () => {
      state.room.mapId = mapSel.value;
      pushConfig();
    });
    right.querySelector<HTMLInputElement>("#rounds")!.addEventListener("change", (e) => {
      state.room.roundsToWin = Number((e.target as HTMLInputElement).value) || 3;
      pushConfig();
    });
    const botsInput = right.querySelector<HTMLInputElement>("#bots");
    botsInput?.addEventListener("change", (e) => {
      state.room.bots = Number((e.target as HTMLInputElement).value) || 0;
      buildLobbyFromQuickPlay();
      refreshList();
    });
    right.querySelector("#back")!.addEventListener("click", () => {
      if (state.online) disconnectOnline();
      setScreen("menu");
    });
    right.querySelector("#ready")!.addEventListener("click", () => {
      const me = state.lobbyPlayers.find((p) => p.id === state.profile.id);
      if (!me) return;
      me.ready = !me.ready;
      if (state.online) net.setReady(me.ready);
      refreshList();
    });
    right.querySelector("#start")!.addEventListener("click", () => {
      if (state.online) {
        if (!state.isHost) return;
        net.start();
      } else {
        startMatchFromLobby();
      }
    });
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
      Controls: Arrow keys or WASD move, Up/W jump, X/Shift heavy, Z/Y special.<br/>
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
  const online = state.online;
  const isHost = online && state.isHost;
  const isClient = online && !state.isHost;

  engine = new BonkEngine(state.room.mode, state.room.mapId, state.room.roundsToWin);
  engine.addPlayers(state.lobbyPlayers);
  renderer = new GameRenderer(canvas);
  input.bind(state.localTwoPlayer && !online);
  snapSendAcc = 0;

  // Remote inputs received by host (playerId → latest bits)
  const remoteInputs = new Map<string, number>();
  let gameNetUnsub: (() => void) | null = null;
  if (online) {
    gameNetUnsub = net.on((msg) => {
      if (msg.type === "input" && isHost) {
        remoteInputs.set(msg.playerId, msg.bits);
      }
      if (msg.type === "chat") {
        chatLines.push(`${msg.from}: ${msg.text}`);
      }
    });
  }

  const hud = el("div", "hud");
  hud.innerHTML = `
    <div class="scoreboard" id="scoreboard"></div>
    <div class="banner" id="banner"></div>
    <div class="chat" id="chat"></div>
    <div class="controls-hint">Arrows/WASD move · X heavy · Z special · Esc menu${online ? ` · ${isHost ? "HOST" : "CLIENT"} ${state.roomCode ?? ""}` : ""}</div>
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

  let pendingBanner: string | undefined;

  engine.on((e) => {
    if (e.type === "banner") {
      banner.textContent = e.text;
      banner.classList.add("show");
      bannerTimer = 1.2;
      pendingBanner = e.text;
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
        gameNetUnsub?.();
        if (online && isHost) net.endMatch();
        setScreen("lobby");
      }, 2500);
    }
  });

  const leaveGame = () => {
    stopGameLoop(true);
    gameNetUnsub?.();
    if (online && isHost) net.endMatch();
    setScreen("lobby");
  };

  hud.querySelector("#leave")!.addEventListener("click", leaveGame);

  gameEscHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") leaveGame();
  };
  window.addEventListener("keydown", gameEscHandler);

  if (!isClient) {
    engine.startRound();
  }
  refreshScore();
  lastTs = performance.now();

  const loop = (ts: number) => {
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    if (!engine || !renderer) return;

    if (isClient) {
      // Clients: send input, apply interpolated snapshots, draw (no local physics)
      net.sendInput(input.primary);
      const latest = snapBuffer.latest();
      const sample = snapBuffer.sample() ?? latest;
      if (sample) {
        engine.applySnapshot(sample);
        if (sample.banner && sample.banner !== lastBannerFromSnap) {
          lastBannerFromSnap = sample.banner;
          banner.textContent = sample.banner;
          banner.classList.add("show");
          bannerTimer = 1.2;
        }
      }
      if (pendingClientMatchOver !== null) {
        const winnerId = pendingClientMatchOver;
        pendingClientMatchOver = null;
        const w = engine.players.find((p) => p.id === winnerId);
        chatLines.push(`Match over — ${w?.name ?? "Someone"} wins!`);
        refreshScore();
        stopGameLoop(true);
        gameNetUnsub?.();
        setTimeout(() => setScreen("lobby"), 1800);
        return;
      }
      if (bannerTimer > 0) {
        bannerTimer -= dt;
        if (bannerTimer <= 0) banner.classList.remove("show");
      }
      refreshScore();
      renderer.draw(engine, state.profile.id);
      raf = requestAnimationFrame(loop);
      return;
    }

    // Host (online) or pure local: run authority sim
    const me = engine.players.find((p) => p.id === state.profile.id);
    if (me) engine.setInput(me.id, input.primary);

    if (online && isHost) {
      for (const [pid, bits] of remoteInputs) {
        if (pid === state.profile.id) continue;
        engine.setInput(pid, unpackInput(bits));
      }
    } else if (state.localTwoPlayer) {
      const p2 = engine.players.find((p) => p.id === "local2");
      if (p2) engine.setInput(p2.id, input.secondary);
    }

    if (!online) {
      for (const p of engine.players) {
        if (p.isBot && p.alive) {
          engine.setInput(p.id, botThink(engine, p));
        }
      }
    }

    engine.update(dt);

    if (online && isHost) {
      snapSendAcc += dt;
      if (snapSendAcc >= 1 / 20) {
        snapSendAcc = 0;
        const snap = engine.getSnapshot(pendingBanner);
        pendingBanner = undefined;
        net.sendSnapshot(snap);
      }
    }

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
