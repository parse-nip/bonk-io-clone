import { COLOR_PALETTE, type MapDef } from "../types";
import {
  blankDocument,
  cloneDoc,
  defaultCapZone,
  defaultPlatform,
  defaultSpawn,
  documentToMapDef,
  eid,
  findElement,
  mapDefToDocument,
  physicalShapeCount,
  type EditorCapZone,
  type EditorDocument,
  type EditorPlatform,
  type EditorSelection,
  type EditorSpawn,
  type MoveType,
  type ShapeKind,
} from "./model";
import {
  deleteCustomMap,
  listEditableMaps,
  loadDraftJson,
  saveDraftJson,
  upsertCustomMap,
} from "./storage";

export interface EditorCallbacks {
  onPlaytest: (map: MapDef) => void;
  onBack: () => void;
  author: string;
}

type PlaceTool = "select" | "box" | "circle" | "polygon" | "spawn" | "capZone";

interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
  grid: boolean;
  snap: number;
}

export function mountEditor(root: HTMLElement, cb: EditorCallbacks): () => void {
  const wrap = document.createElement("div");
  wrap.className = "editor-layout editor-full";

  let doc = restoreOrBlank(cb.author);
  let selection: EditorSelection = null;
  let tool: PlaceTool = "select";
  let brushColor = COLOR_PALETTE[3];
  let dirty = false;
  let showMapProps = false;
  let infoText = "Select an element or place a new one.";
  const history: EditorDocument[] = [cloneDoc(doc)];
  let histIndex = 0;
  const view: ViewState = { zoom: 1, panX: 0, panY: 0, grid: true, snap: 10 };

  // drag state
  let dragging: null | {
    id: string;
    kind: "platform" | "spawn" | "capZone" | "pivot";
    ox: number;
    oy: number;
    sx: number;
    sy: number;
  } = null;
  let panning: null | { x: number; y: number; panX: number; panY: number } = null;
  let resizing: null | {
    id: string;
    startW: number;
    startH: number;
    startR: number;
    sx: number;
    sy: number;
  } = null;
  let dragMoved = false;

  const elements = document.createElement("div");
  elements.className = "panel editor-panel editor-elements";
  const preview = document.createElement("div");
  preview.className = "panel editor-panel editor-preview";
  const props = document.createElement("div");
  props.className = "panel editor-panel editor-props";

  preview.innerHTML = `
    <div class="editor-toolbar">
      <button class="ed-icon" id="undo" title="Undo">↶</button>
      <button class="ed-icon" id="redo" title="Redo">↷</button>
      <button class="ed-icon" id="mapprops" title="Map Properties">⚙</button>
      <button class="ed-icon" id="grid" title="Toggle Grid">▦</button>
      <button class="ed-icon" id="fit" title="Fit View">⊡</button>
      <button class="ed-icon" id="zoomin" title="Zoom In">+</button>
      <button class="ed-icon" id="zoomout" title="Zoom Out">−</button>
      <span class="ed-sep"></span>
      <button class="ed-icon" id="tool-select" title="Select">↖</button>
      <button class="ed-icon" id="tool-box" title="Box">▭</button>
      <button class="ed-icon" id="tool-circle" title="Circle">◯</button>
      <button class="ed-icon" id="tool-poly" title="Polygon">⬠</button>
      <button class="ed-icon" id="tool-spawn" title="Spawn">●</button>
      <button class="ed-icon" id="tool-cap" title="Capture Zone">◎</button>
    </div>
    <canvas id="ed-canvas"></canvas>
    <div class="editor-preview-foot">
      <div class="editor-info" id="ed-info"></div>
      <div class="editor-finalize">
        <button class="btn-brown small" id="new">New</button>
        <button class="btn-brown small" id="load">Load</button>
        <button class="btn-brown small" id="save">Save</button>
        <button class="btn-brown small" id="export">Export</button>
        <button class="btn-brown small" id="play">Play</button>
        <button class="btn-brown small" id="back">Back</button>
      </div>
    </div>
  `;

  wrap.append(elements, preview, props);
  root.appendChild(wrap);

  const canvas = preview.querySelector<HTMLCanvasElement>("#ed-canvas")!;
  const infoEl = preview.querySelector<HTMLElement>("#ed-info")!;
  /** CSS-pixel drawing size (backing store is cssW/H × devicePixelRatio). */
  let cssW = 420;
  let cssH = 280;
  let canvasDpr = 1;

  const pushHistory = () => {
    history.splice(histIndex + 1);
    history.push(cloneDoc(doc));
    if (history.length > 80) history.shift();
    histIndex = history.length - 1;
    dirty = true;
    persistDraft();
  };

  const persistDraft = () => {
    try {
      saveDraftJson(JSON.stringify(documentToMapDef(doc)));
    } catch {
      /* ignore quota */
    }
  };

  const setDoc = (next: EditorDocument, record = true) => {
    doc = next;
    if (record) pushHistory();
    else persistDraft();
    renderAll();
  };

  const undo = () => {
    if (histIndex <= 0) return;
    histIndex -= 1;
    doc = cloneDoc(history[histIndex]);
    dirty = true;
    renderAll();
  };

  const redo = () => {
    if (histIndex >= history.length - 1) return;
    histIndex += 1;
    doc = cloneDoc(history[histIndex]);
    dirty = true;
    renderAll();
  };

  const snap = (v: number) =>
    view.grid ? Math.round(v / view.snap) * view.snap : Math.round(v);

  function resizeCanvas() {
    // clientWidth/Height = content box (excludes border). Using
    // getBoundingClientRect() overshoots by the 2px border and the browser
    // then soft-scales the bitmap down into the content box.
    // Never undersample (dpr < 1 from browser zoom-out soft-scales back up).
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    const nextW = Math.max(1, canvas.clientWidth || 1);
    const nextH = Math.max(1, canvas.clientHeight || 1);
    const bw = Math.max(1, Math.floor(nextW * dpr));
    const bh = Math.max(1, Math.floor(nextH * dpr));
    cssW = nextW;
    cssH = nextH;
    canvasDpr = dpr;
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
  }

  function screenToWorld(clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    // Subtract border (clientLeft/Top) so coords match the content-box bitmap.
    const sx = clientX - rect.left - canvas.clientLeft;
    const sy = clientY - rect.top - canvas.clientTop;
    const fit = fitScale();
    const scale = fit * view.zoom;
    const ox = (cssW - doc.width * scale) / 2 + view.panX;
    const oy = (cssH - doc.height * scale) / 2 + view.panY;
    return { x: (sx - ox) / scale, y: (sy - oy) / scale };
  }

  function fitScale() {
    // Cap at 1:1 — fullscreen should add margin around the map, not blow it up.
    // Zoom buttons / wheel still let you inspect past native size.
    return Math.min(1, Math.min(cssW / doc.width, cssH / doc.height) * 0.92);
  }

  /** World-space hit radius that stays ~constant on screen across zoom/fit. */
  function screenHitWorld(px = 12) {
    return Math.max(8, px / Math.max(0.001, fitScale() * view.zoom));
  }

  function platformPivotWorld(p: EditorPlatform) {
    const rad = (p.angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      x: p.x + p.pivotX * cos - p.pivotY * sin,
      y: p.y + p.pivotX * sin + p.pivotY * cos,
    };
  }

  function worldToPlatformLocal(p: EditorPlatform, wx: number, wy: number) {
    const dx = wx - p.x;
    const dy = wy - p.y;
    const rad = (p.angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
  }

  function hitPivot(p: EditorPlatform, wx: number, wy: number): boolean {
    if (p.moveType !== "rotate") return false;
    const piv = platformPivotWorld(p);
    const r = screenHitWorld(14);
    return (wx - piv.x) ** 2 + (wy - piv.y) ** 2 <= r * r;
  }

  function hitTest(wx: number, wy: number): EditorSelection {
    // Prefer the selected rotate platform's pivot so it stays grabable on top.
    if (selection?.kind === "platform") {
      const selectedId = selection.id;
      const selP = doc.platforms.find((p) => p.id === selectedId);
      if (selP && hitPivot(selP, wx, wy)) return { kind: "platform", id: selP.id };
    }
    for (let i = doc.platforms.length - 1; i >= 0; i--) {
      const p = doc.platforms[i];
      if (hitPivot(p, wx, wy)) return { kind: "platform", id: p.id };
    }
    for (let i = doc.capZones.length - 1; i >= 0; i--) {
      const z = doc.capZones[i];
      if (hitCap(z, wx, wy)) return { kind: "capZone", id: z.id };
    }
    for (let i = doc.spawns.length - 1; i >= 0; i--) {
      const s = doc.spawns[i];
      const spawnR = Math.max(14, screenHitWorld(12));
      if ((wx - s.x) ** 2 + (wy - s.y) ** 2 <= spawnR * spawnR) {
        return { kind: "spawn", id: s.id };
      }
    }
    for (let i = doc.platforms.length - 1; i >= 0; i--) {
      const p = doc.platforms[i];
      if (hitPlatform(p, wx, wy)) return { kind: "platform", id: p.id };
    }
    return null;
  }

  function hitPlatform(p: EditorPlatform, wx: number, wy: number): boolean {
    const dx = wx - p.x;
    const dy = wy - p.y;
    const rad = (-p.angle * Math.PI) / 180;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    if (p.type === "circle") return lx * lx + ly * ly <= p.r * p.r;
    if (p.type === "box") return Math.abs(lx) <= p.w / 2 && Math.abs(ly) <= p.h / 2;
    return pointInPoly(lx, ly, p.vertices);
  }

  function hitCap(z: EditorCapZone, wx: number, wy: number): boolean {
    if (z.type === "circle") {
      return (wx - z.x) ** 2 + (wy - z.y) ** 2 <= z.r * z.r;
    }
    return Math.abs(wx - z.x) <= z.w / 2 && Math.abs(wy - z.y) <= z.h / 2;
  }

  function pointInPoly(x: number, y: number, verts: { x: number; y: number }[]) {
    let inside = false;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
      const xi = verts[i].x;
      const yi = verts[i].y;
      const xj = verts[j].x;
      const yj = verts[j].y;
      const intersect =
        yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function renderAll() {
    renderElements();
    renderProps();
    drawCanvas();
    infoEl.textContent = `${infoText}  ·  Physical shapes: ${physicalShapeCount(doc)}${dirty ? "  ·  unsaved" : ""}`;
    preview.querySelectorAll<HTMLButtonElement>(".ed-icon").forEach((b) => {
      b.classList.toggle("active", b.id === `tool-${tool === "polygon" ? "poly" : tool}`);
    });
    preview.querySelector("#grid")!.classList.toggle("active", view.grid);
    preview.querySelector("#mapprops")!.classList.toggle("active", showMapProps);
  }

  function renderElements() {
    elements.innerHTML = `
      <div class="ed-colorbar" id="colorbar" title="Brush color" style="background:${brushColor}"></div>
      <div class="ed-el-scroll">
        <details open class="ed-section">
          <summary>Platforms (${doc.platforms.length})</summary>
          <div id="plat-list"></div>
        </details>
        <details open class="ed-section">
          <summary>Spawns (${doc.spawns.length})</summary>
          <div id="spawn-list"></div>
        </details>
        <details open class="ed-section">
          <summary>Capture Zones (${doc.capZones.length})</summary>
          <div id="cap-list"></div>
        </details>
      </div>
      <div class="ed-el-actions">
        <button class="ed-icon" id="add" title="Add">+</button>
        <button class="ed-icon danger" id="del" title="Delete selected (Del)">Delete</button>
        <button class="ed-icon" id="dup" title="Duplicate (Ctrl+D)">⧉</button>
        <button class="ed-icon" id="up" title="Move Up">▲</button>
        <button class="ed-icon" id="down" title="Move Down">▼</button>
      </div>
      <div class="ed-add-menu hidden" id="add-menu">
        <button data-add="box">Platform · Box</button>
        <button data-add="circle">Platform · Circle</button>
        <button data-add="polygon">Platform · Polygon</button>
        <button data-add="free">Platform · Free Moving</button>
        <button data-add="rotate">Platform · Rotating</button>
        <button data-add="spawn">Spawn</button>
        <button data-add="capZone">Capture Zone</button>
      </div>
    `;

    const platList = elements.querySelector("#plat-list")!;
    for (const p of doc.platforms) {
      const row = document.createElement("div");
      row.className = "ed-el-row";
      if (selection?.kind === "platform" && selection.id === p.id) row.classList.add("active");
      const tag = p.type === "circle" ? "C" : p.type === "polygon" ? "P" : "R";
      const move =
        p.moveType === "rotate" ? "·piv" : p.moveType === "free" ? "·free" : "";
      row.innerHTML = `<button class="ed-el-pick" type="button"><span class="sw" style="background:${p.color}"></span><span>${escape(p.name)}</span><span class="tag">${tag}${move}${p.noPhysics ? "·n" : ""}</span></button><button class="ed-el-del" type="button" title="Delete">✕</button>`;
      row.querySelector(".ed-el-pick")!.addEventListener("click", () => {
        selection = { kind: "platform", id: p.id };
        showMapProps = false;
        infoText = `Platform: ${p.name}`;
        renderAll();
      });
      row.querySelector(".ed-el-del")!.addEventListener("click", (e) => {
        e.stopPropagation();
        selection = { kind: "platform", id: p.id };
        deleteSelected();
      });
      platList.appendChild(row);
    }

    const spawnList = elements.querySelector("#spawn-list")!;
    for (const s of doc.spawns) {
      const row = document.createElement("div");
      row.className = "ed-el-row";
      if (selection?.kind === "spawn" && selection.id === s.id) row.classList.add("active");
      row.innerHTML = `<button class="ed-el-pick" type="button"><span class="sw" style="background:${spawnColor(s)}"></span><span>Spawn</span><span class="tag">${Math.round(s.x)},${Math.round(s.y)}</span></button><button class="ed-el-del" type="button" title="Delete">✕</button>`;
      row.querySelector(".ed-el-pick")!.addEventListener("click", () => {
        selection = { kind: "spawn", id: s.id };
        showMapProps = false;
        infoText = "Spawn point";
        renderAll();
      });
      row.querySelector(".ed-el-del")!.addEventListener("click", (e) => {
        e.stopPropagation();
        selection = { kind: "spawn", id: s.id };
        deleteSelected();
      });
      spawnList.appendChild(row);
    }

    const capList = elements.querySelector("#cap-list")!;
    for (const z of doc.capZones) {
      const row = document.createElement("div");
      row.className = "ed-el-row";
      if (selection?.kind === "capZone" && selection.id === z.id) row.classList.add("active");
      row.innerHTML = `<button class="ed-el-pick" type="button"><span class="sw" style="background:#f1c40f"></span><span>${escape(z.name)}</span></button><button class="ed-el-del" type="button" title="Delete">✕</button>`;
      row.querySelector(".ed-el-pick")!.addEventListener("click", () => {
        selection = { kind: "capZone", id: z.id };
        showMapProps = false;
        infoText = `Capture zone: ${z.name}`;
        renderAll();
      });
      row.querySelector(".ed-el-del")!.addEventListener("click", (e) => {
        e.stopPropagation();
        selection = { kind: "capZone", id: z.id };
        deleteSelected();
      });
      capList.appendChild(row);
    }

    elements.querySelector("#colorbar")!.addEventListener("click", () => {
      const next = COLOR_PALETTE[(COLOR_PALETTE.indexOf(brushColor) + 1) % COLOR_PALETTE.length];
      brushColor = next;
      const el = findElement(doc, selection);
      if (el && el.kind === "platform") {
        el.color = brushColor;
        pushHistory();
      }
      renderAll();
    });

    const addMenu = elements.querySelector<HTMLElement>("#add-menu")!;
    elements.querySelector("#add")!.addEventListener("click", () => {
      addMenu.classList.toggle("hidden");
    });
    addMenu.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        addMenu.classList.add("hidden");
        addElement(b.getAttribute("data-add")!);
      });
    });
    elements.querySelector("#del")!.addEventListener("click", deleteSelected);
    elements.querySelector("#dup")!.addEventListener("click", duplicateSelected);
    elements.querySelector("#up")!.addEventListener("click", () => reorderSelected(-1));
    elements.querySelector("#down")!.addEventListener("click", () => reorderSelected(1));
  }

  function addElement(kind: string) {
    const cx = snap(doc.width / 2);
    const cy = snap(doc.height / 2 - 40);
    if (kind === "spawn") {
      const s = defaultSpawn(cx, cy);
      doc.spawns.push(s);
      selection = { kind: "spawn", id: s.id };
    } else if (kind === "capZone") {
      const z = defaultCapZone(cx, cy);
      doc.capZones.push(z);
      selection = { kind: "capZone", id: z.id };
    } else {
      const type: ShapeKind =
        kind === "circle" ? "circle" : kind === "polygon" ? "polygon" : "box";
      const p = defaultPlatform(type, cx, cy, brushColor);
      if (kind === "free") p.moveType = "free";
      if (kind === "rotate") p.moveType = "rotate";
      doc.platforms.push(p);
      selection = { kind: "platform", id: p.id };
    }
    showMapProps = false;
    pushHistory();
    renderAll();
  }

  function deleteSelected() {
    if (!selection || selection.kind === "map") {
      infoText = "Select something first, then Delete (or use ✕ on a list row).";
      renderAll();
      return;
    }
    const id = selection.id;
    const kind = selection.kind;
    if (kind === "platform") {
      doc.platforms = doc.platforms.filter((p) => p.id !== id);
    } else if (kind === "spawn") {
      doc.spawns = doc.spawns.filter((p) => p.id !== id);
    } else {
      doc.capZones = doc.capZones.filter((p) => p.id !== id);
    }
    selection = null;
    infoText = `Deleted ${kind}.`;
    pushHistory();
    renderAll();
  }

  function duplicateSelected() {
    if (!selection || selection.kind === "map") return;
    const id = selection.id;
    if (selection.kind === "platform") {
      const src = doc.platforms.find((p) => p.id === id);
      if (!src) return;
      const copy = structuredClone(src);
      copy.id = eid("p");
      copy.x += 20;
      copy.y += 20;
      copy.name = `${src.name} Copy`;
      doc.platforms.push(copy);
      selection = { kind: "platform", id: copy.id };
    } else if (selection.kind === "spawn") {
      const src = doc.spawns.find((p) => p.id === id);
      if (!src) return;
      const copy = structuredClone(src);
      copy.id = eid("s");
      copy.x += 20;
      doc.spawns.push(copy);
      selection = { kind: "spawn", id: copy.id };
    } else {
      const src = doc.capZones.find((p) => p.id === id);
      if (!src) return;
      const copy = structuredClone(src);
      copy.id = eid("c");
      copy.x += 20;
      doc.capZones.push(copy);
      selection = { kind: "capZone", id: copy.id };
    }
    pushHistory();
    renderAll();
  }

  function reorderSelected(dir: number) {
    if (!selection || selection.kind === "map") return;
    const id = selection.id;
    const list =
      selection.kind === "platform"
        ? doc.platforms
        : selection.kind === "spawn"
          ? doc.spawns
          : doc.capZones;
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    const tmp = list[idx];
    list[idx] = list[j];
    list[j] = tmp;
    pushHistory();
    renderAll();
  }

  function renderProps() {
    if (showMapProps || selection?.kind === "map") {
      props.innerHTML = mapPropsHtml(doc);
      wireMapProps();
      return;
    }
    const el = findElement(doc, selection);
    if (!el) {
      props.innerHTML = `
        <h4>Properties</h4>
        <p class="ed-hint">Select a platform, spawn, or capture zone. Use ⚙ for map properties.</p>
        <div class="swatches" id="brush-swatches"></div>
      `;
      fillSwatches(props.querySelector("#brush-swatches")!, (c) => {
        brushColor = c;
        renderAll();
      });
      return;
    }
    if (el.kind === "platform") {
      props.innerHTML = platformPropsHtml(el);
      wirePlatformProps(el);
    } else if (el.kind === "spawn") {
      props.innerHTML = spawnPropsHtml(el);
      wireSpawnProps(el);
    } else {
      props.innerHTML = capPropsHtml(el);
      wireCapProps(el);
    }
  }

  function wireMapProps() {
    const bindNum = (id: string, apply: (v: number) => void) => {
      props.querySelector(`#${id}`)?.addEventListener("change", (e) => {
        apply(Number((e.target as HTMLInputElement).value));
        pushHistory();
        renderAll();
      });
    };
    const bindStr = (id: string, apply: (v: string) => void) => {
      props.querySelector(`#${id}`)?.addEventListener("change", (e) => {
        apply((e.target as HTMLInputElement | HTMLSelectElement).value);
        pushHistory();
        renderAll();
      });
    };
    bindStr("mp-name", (v) => (doc.name = v));
    bindStr("mp-author", (v) => (doc.author = v));
    bindStr("mp-mode", (v) => (doc.modeHint = v as EditorDocument["modeHint"]));
    bindNum("mp-w", (v) => (doc.width = clamp(v, 400, 1600)));
    bindNum("mp-h", (v) => (doc.height = clamp(v, 300, 1200)));
    bindNum("mp-gx", (v) => (doc.gravityX = v));
    bindNum("mp-gy", (v) => (doc.gravityY = v));
    bindNum("mp-killy", (v) => (doc.killY = v));
    bindNum("mp-pad", (v) => (doc.killPadding = v));
    props.querySelector("#mp-size")?.addEventListener("change", (e) => {
      const v = (e.target as HTMLSelectElement).value;
      if (v === "small") {
        doc.width = 600;
        doc.height = 400;
        doc.killY = 440;
      } else if (v === "big") {
        doc.width = 980;
        doc.height = 640;
        doc.killY = 700;
      } else {
        doc.width = 780;
        doc.height = 520;
        doc.killY = 560;
      }
      pushHistory();
      renderAll();
    });
  }

  function wirePlatformProps(p: EditorPlatform) {
    const commit = () => {
      pushHistory();
      renderAll();
    };
    const num = (id: string, key: keyof EditorPlatform) => {
      props.querySelector(`#${id}`)?.addEventListener("change", (e) => {
        (p as unknown as Record<string, number>)[key as string] = Number(
          (e.target as HTMLInputElement).value,
        );
        commit();
      });
    };
    props.querySelector("#pp-name")?.addEventListener("change", (e) => {
      p.name = (e.target as HTMLInputElement).value || "Unnamed";
      commit();
    });
    num("pp-x", "x");
    num("pp-y", "y");
    num("pp-w", "w");
    num("pp-h", "h");
    num("pp-r", "r");
    // Angle edits on rotating platforms keep the world pivot fixed so the
    // body orbits the offset hinge (matches in-game revolute behavior).
    props.querySelector("#pp-angle")?.addEventListener("change", (e) => {
      const next = Number((e.target as HTMLInputElement).value);
      if (p.moveType === "rotate" && (p.pivotX !== 0 || p.pivotY !== 0)) {
        const oldRad = (p.angle * Math.PI) / 180;
        const newRad = (next * Math.PI) / 180;
        const oc = Math.cos(oldRad);
        const os = Math.sin(oldRad);
        const pivWx = p.x + p.pivotX * oc - p.pivotY * os;
        const pivWy = p.y + p.pivotX * os + p.pivotY * oc;
        const nc = Math.cos(newRad);
        const ns = Math.sin(newRad);
        p.x = pivWx - (p.pivotX * nc - p.pivotY * ns);
        p.y = pivWy - (p.pivotX * ns + p.pivotY * nc);
      }
      p.angle = next;
      commit();
    });
    num("pp-bounce", "restitution");
    num("pp-dens", "density");
    num("pp-fric", "friction");
    num("pp-ssx", "startSpeedX");
    num("pp-ssy", "startSpeedY");
    num("pp-spin", "startSpin");
    num("pp-adamp", "angularDamping");
    num("pp-pivx", "pivotX");
    num("pp-pivy", "pivotY");
    props.querySelector("#pp-move")?.addEventListener("change", (e) => {
      p.moveType = (e.target as HTMLSelectElement).value as MoveType;
      commit();
    });
    props.querySelector("#pp-death")?.addEventListener("change", (e) => {
      p.death = (e.target as HTMLInputElement).checked;
      commit();
    });
    props.querySelector("#pp-nophys")?.addEventListener("change", (e) => {
      p.noPhysics = (e.target as HTMLInputElement).checked;
      commit();
    });
    props.querySelector("#pp-fricp")?.addEventListener("change", (e) => {
      p.fricPlayers = (e.target as HTMLInputElement).checked;
      commit();
    });
    props.querySelector("#pp-fixrot")?.addEventListener("change", (e) => {
      p.fixedRotation = (e.target as HTMLInputElement).checked;
      commit();
    });
    props.querySelector("#pp-piv-center")?.addEventListener("click", () => {
      p.pivotX = 0;
      p.pivotY = 0;
      commit();
    });
    props.querySelector("#pp-delete")?.addEventListener("click", () => deleteSelected());
    const sw = props.querySelector("#pp-swatches");
    if (sw) {
      fillSwatches(sw, (c) => {
        p.color = c;
        brushColor = c;
        commit();
      }, p.color);
    }
    props.querySelector("#pp-dup-invx")?.addEventListener("click", () => {
      const copy = structuredClone(p);
      copy.id = eid("p");
      copy.x = doc.width - p.x;
      copy.pivotX = -p.pivotX;
      copy.angle = -p.angle;
      copy.name = `${p.name} InvX`;
      doc.platforms.push(copy);
      selection = { kind: "platform", id: copy.id };
      commit();
    });
    props.querySelector("#pp-dup-invy")?.addEventListener("click", () => {
      const copy = structuredClone(p);
      copy.id = eid("p");
      copy.y = doc.height - p.y;
      copy.pivotY = -p.pivotY;
      copy.angle = -p.angle;
      copy.name = `${p.name} InvY`;
      doc.platforms.push(copy);
      selection = { kind: "platform", id: copy.id };
      commit();
    });
  }

  function wireSpawnProps(s: EditorSpawn) {
    const commit = () => {
      pushHistory();
      renderAll();
    };
    const num = (id: string, key: keyof EditorSpawn) => {
      props.querySelector(`#${id}`)?.addEventListener("change", (e) => {
        (s as unknown as Record<string, number>)[key as string] = Number(
          (e.target as HTMLInputElement).value,
        );
        commit();
      });
    };
    const chk = (id: string, key: keyof EditorSpawn) => {
      props.querySelector(`#${id}`)?.addEventListener("change", (e) => {
        (s as unknown as Record<string, boolean>)[key as string] = (
          e.target as HTMLInputElement
        ).checked;
        commit();
      });
    };
    num("sp-x", "x");
    num("sp-y", "y");
    num("sp-ssx", "startSpeedX");
    num("sp-ssy", "startSpeedY");
    num("sp-pri", "priority");
    chk("sp-ffa", "ffa");
    chk("sp-red", "red");
    chk("sp-blue", "blue");
    chk("sp-green", "green");
    chk("sp-yellow", "yellow");
    props.querySelector("#sp-delete")?.addEventListener("click", () => deleteSelected());
  }

  function wireCapProps(z: EditorCapZone) {
    const commit = () => {
      pushHistory();
      renderAll();
    };
    props.querySelector("#cz-name")?.addEventListener("change", (e) => {
      z.name = (e.target as HTMLInputElement).value || "Capture";
      commit();
    });
    props.querySelector("#cz-type")?.addEventListener("change", (e) => {
      z.type = (e.target as HTMLSelectElement).value as "box" | "circle";
      commit();
    });
    for (const [id, key] of [
      ["cz-x", "x"],
      ["cz-y", "y"],
      ["cz-w", "w"],
      ["cz-h", "h"],
      ["cz-r", "r"],
    ] as const) {
      props.querySelector(`#${id}`)?.addEventListener("change", (e) => {
        (z as unknown as Record<string, number>)[key] = Number(
          (e.target as HTMLInputElement).value,
        );
        commit();
      });
    }
    props.querySelector("#cz-delete")?.addEventListener("click", () => deleteSelected());
  }

  function drawCanvas() {
    resizeCanvas();
    const ctx = canvas.getContext("2d")!;
    // Draw in CSS pixels; backing store is denser on HiDPI displays.
    ctx.setTransform(canvasDpr, 0, 0, canvasDpr, 0, 0);
    ctx.fillStyle = "#2c2c2c";
    ctx.fillRect(0, 0, cssW, cssH);

    const fit = fitScale();
    const scale = fit * view.zoom;
    const ox = (cssW - doc.width * scale) / 2 + view.panX;
    const oy = (cssH - doc.height * scale) / 2 + view.panY;

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    // playfield
    ctx.fillStyle = "#333";
    ctx.fillRect(0, 0, doc.width, doc.height);
    ctx.strokeStyle = "#f1c40f";
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(0, 0, doc.width, doc.height);

    if (view.grid) {
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1 / scale;
      for (let x = 0; x <= doc.width; x += view.snap) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, doc.height);
        ctx.stroke();
      }
      for (let y = 0; y <= doc.height; y += view.snap) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(doc.width, y);
        ctx.stroke();
      }
    }

    for (const p of doc.platforms) drawPlatform(ctx, p, scale);
    for (const z of doc.capZones) drawCap(ctx, z, scale);
    for (const s of doc.spawns) drawSpawn(ctx, s, scale);

    ctx.restore();
  }

  function drawPlatform(ctx: CanvasRenderingContext2D, p: EditorPlatform, scale: number) {
    const selected = selection?.kind === "platform" && selection.id === p.id;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((p.angle * Math.PI) / 180);
    ctx.globalAlpha = p.noPhysics ? 0.45 : 1;
    ctx.fillStyle = p.color;
    ctx.strokeStyle = selected ? "#fff" : p.death ? "#ff2222" : "rgba(0,0,0,0.4)";
    ctx.lineWidth = (selected ? 3 : 2) / scale;

    if (p.type === "circle") {
      ctx.beginPath();
      ctx.arc(0, 0, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (p.type === "polygon" && p.vertices.length) {
      ctx.beginPath();
      ctx.moveTo(p.vertices[0].x, p.vertices[0].y);
      for (let i = 1; i < p.vertices.length; i++) {
        ctx.lineTo(p.vertices[i].x, p.vertices[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }

    if (p.moveType === "rotate") {
      // Pivot marker in local space (draggable independently of body).
      ctx.strokeStyle = "#f1c40f";
      ctx.fillStyle = "rgba(241,196,15,0.35)";
      ctx.lineWidth = 2 / scale;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(p.pivotX, p.pivotY);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.pivotX, p.pivotY, 7 / scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Crosshair for grab affordance
      ctx.beginPath();
      ctx.moveTo(p.pivotX - 10 / scale, p.pivotY);
      ctx.lineTo(p.pivotX + 10 / scale, p.pivotY);
      ctx.moveTo(p.pivotX, p.pivotY - 10 / scale);
      ctx.lineTo(p.pivotX, p.pivotY + 10 / scale);
      ctx.stroke();
    } else if (p.moveType === "free") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(-3 / scale, -3 / scale, 6 / scale, 6 / scale);
    }

    if (selected && p.type !== "polygon") {
      ctx.fillStyle = "#fff";
      const hx = p.type === "circle" ? p.r : p.w / 2;
      const hy = p.type === "circle" ? 0 : p.h / 2;
      ctx.fillRect(hx - 4 / scale, hy - 4 / scale, 8 / scale, 8 / scale);
    }
    ctx.restore();
  }

  function drawSpawn(ctx: CanvasRenderingContext2D, s: EditorSpawn, scale: number) {
    const selected = selection?.kind === "spawn" && selection.id === s.id;
    ctx.beginPath();
    ctx.fillStyle = spawnColor(s);
    ctx.strokeStyle = selected ? "#fff" : "#111";
    ctx.lineWidth = (selected ? 3 : 2) / scale;
    ctx.arc(s.x, s.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function drawCap(ctx: CanvasRenderingContext2D, z: EditorCapZone, scale: number) {
    const selected = selection?.kind === "capZone" && selection.id === z.id;
    ctx.save();
    ctx.strokeStyle = selected ? "#fff" : "#f1c40f";
    ctx.fillStyle = "rgba(241,196,15,0.15)";
    ctx.lineWidth = 2 / scale;
    ctx.setLineDash([6 / scale, 4 / scale]);
    if (z.type === "circle") {
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
      ctx.strokeRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
    }
    ctx.restore();
  }

  // —— canvas interaction ——
  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      panning = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY };
      return;
    }
    const w = screenToWorld(e.clientX, e.clientY);
    if (tool !== "select") {
      placeAt(w.x, w.y);
      return;
    }
    dragMoved = false;
    const hit = hitTest(w.x, w.y);
    selection = hit;
    showMapProps = false;
    if (hit && hit.kind === "platform") {
      const p = doc.platforms.find((x) => x.id === hit.id)!;
      if (hitPivot(p, w.x, w.y)) {
        dragging = {
          id: p.id,
          kind: "pivot",
          ox: p.pivotX,
          oy: p.pivotY,
          sx: w.x,
          sy: w.y,
        };
        infoText = `Drag pivot for ${p.name} (local ${Math.round(p.pivotX)}, ${Math.round(p.pivotY)})`;
        renderAll();
        return;
      }
      // resize handle near right edge
      const dx = w.x - p.x;
      const dy = w.y - p.y;
      const rad = (-p.angle * Math.PI) / 180;
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
      const handleSlop = screenHitWorld(12);
      const nearHandle =
        p.type === "circle"
          ? Math.abs(Math.hypot(lx, ly) - p.r) < handleSlop
          : Math.abs(lx - p.w / 2) < handleSlop &&
            Math.abs(ly - p.h / 2) < handleSlop;
      if (nearHandle) {
        resizing = {
          id: p.id,
          startW: p.w,
          startH: p.h,
          startR: p.r,
          sx: w.x,
          sy: w.y,
        };
      } else {
        dragging = {
          id: p.id,
          kind: "platform",
          ox: p.x,
          oy: p.y,
          sx: w.x,
          sy: w.y,
        };
      }
      infoText =
        p.moveType === "rotate"
          ? `Platform: ${p.name} — drag yellow crosshair to move pivot`
          : `Platform: ${p.name}`;
    } else if (hit && hit.kind === "spawn") {
      const s = doc.spawns.find((x) => x.id === hit.id)!;
      dragging = { id: s.id, kind: "spawn", ox: s.x, oy: s.y, sx: w.x, sy: w.y };
      infoText = "Spawn point";
    } else if (hit && hit.kind === "capZone") {
      const z = doc.capZones.find((x) => x.id === hit.id)!;
      dragging = { id: z.id, kind: "capZone", ox: z.x, oy: z.y, sx: w.x, sy: w.y };
      infoText = `Capture zone: ${z.name}`;
    } else {
      infoText = "Select an element or place a new one. Del deletes · Ctrl+D duplicates";
    }
    renderAll();
  });

  const onMove = (e: MouseEvent) => {
    if (panning) {
      view.panX = panning.panX + (e.clientX - panning.x);
      view.panY = panning.panY + (e.clientY - panning.y);
      drawCanvas();
      return;
    }
    const w = screenToWorld(e.clientX, e.clientY);
    if (resizing) {
      const p = doc.platforms.find((x) => x.id === resizing!.id);
      if (!p) return;
      dragMoved = true;
      if (p.type === "circle") {
        p.r = Math.max(8, snap(Math.hypot(w.x - p.x, w.y - p.y)));
      } else {
        // Resize in local space so angled platforms keep correct extents.
        const local = worldToPlatformLocal(p, w.x, w.y);
        p.w = Math.max(12, snap(Math.abs(local.x) * 2));
        p.h = Math.max(8, snap(Math.abs(local.y) * 2));
      }
      drawCanvas();
      return;
    }
    if (dragging) {
      const dx = w.x - dragging.sx;
      const dy = w.y - dragging.sy;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) dragMoved = true;
      if (dragging.kind === "pivot") {
        const p = doc.platforms.find((x) => x.id === dragging!.id);
        if (p) {
          const local = worldToPlatformLocal(p, w.x, w.y);
          p.pivotX = snap(local.x);
          p.pivotY = snap(local.y);
          infoText = `Pivot ${Math.round(p.pivotX)}, ${Math.round(p.pivotY)}`;
        }
      } else {
        const nx = snap(dragging.ox + dx);
        const ny = snap(dragging.oy + dy);
        if (dragging.kind === "platform") {
          const p = doc.platforms.find((x) => x.id === dragging!.id);
          if (p) {
            p.x = nx;
            p.y = ny;
          }
        } else if (dragging.kind === "spawn") {
          const s = doc.spawns.find((x) => x.id === dragging!.id);
          if (s) {
            s.x = nx;
            s.y = ny;
          }
        } else {
          const z = doc.capZones.find((x) => x.id === dragging!.id);
          if (z) {
            z.x = nx;
            z.y = ny;
          }
        }
      }
      drawCanvas();
    }
  };

  const onUp = () => {
    if ((dragging || resizing) && dragMoved) {
      pushHistory();
      renderAll();
    } else if (dragging || resizing) {
      renderAll();
    }
    dragging = null;
    resizing = null;
    panning = null;
    dragMoved = false;
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);

  function placeAt(x: number, y: number) {
    const px = snap(x);
    const py = snap(y);
    if (tool === "spawn") {
      const s = defaultSpawn(px, py);
      doc.spawns.push(s);
      selection = { kind: "spawn", id: s.id };
    } else if (tool === "capZone") {
      const z = defaultCapZone(px, py);
      doc.capZones.push(z);
      selection = { kind: "capZone", id: z.id };
    } else if (tool === "box" || tool === "circle" || tool === "polygon") {
      const p = defaultPlatform(tool, px, py, brushColor);
      doc.platforms.push(p);
      selection = { kind: "platform", id: p.id };
    }
    tool = "select";
    pushHistory();
    renderAll();
  }

  // toolbar
  const toolMap: Record<string, PlaceTool> = {
    "tool-select": "select",
    "tool-box": "box",
    "tool-circle": "circle",
    "tool-poly": "polygon",
    "tool-spawn": "spawn",
    "tool-cap": "capZone",
  };
  for (const [id, t] of Object.entries(toolMap)) {
    preview.querySelector(`#${id}`)!.addEventListener("click", () => {
      tool = t;
      infoText = t === "select" ? "Select mode" : `Place ${t}`;
      renderAll();
    });
  }
  preview.querySelector("#undo")!.addEventListener("click", undo);
  preview.querySelector("#redo")!.addEventListener("click", redo);
  preview.querySelector("#grid")!.addEventListener("click", () => {
    view.grid = !view.grid;
    renderAll();
  });
  preview.querySelector("#mapprops")!.addEventListener("click", () => {
    showMapProps = !showMapProps;
    if (showMapProps) selection = { kind: "map" };
    renderAll();
  });
  preview.querySelector("#fit")!.addEventListener("click", () => {
    view.zoom = 1;
    view.panX = 0;
    view.panY = 0;
    renderAll();
  });
  preview.querySelector("#zoomin")!.addEventListener("click", () => {
    view.zoom = Math.min(3, view.zoom * 1.2);
    renderAll();
  });
  preview.querySelector("#zoomout")!.addEventListener("click", () => {
    view.zoom = Math.max(0.4, view.zoom / 1.2);
    renderAll();
  });

  preview.querySelector("#new")!.addEventListener("click", () => {
    if (dirty && !confirm("Clear map? Unsaved changes will be lost.")) return;
    const sure = (preview.querySelector("#new") as HTMLButtonElement).dataset.sure === "1";
    if (!sure) {
      (preview.querySelector("#new") as HTMLButtonElement).textContent = "Sure?";
      (preview.querySelector("#new") as HTMLButtonElement).dataset.sure = "1";
      setTimeout(() => {
        const b = preview.querySelector("#new") as HTMLButtonElement;
        b.textContent = "New";
        b.dataset.sure = "0";
      }, 2500);
      return;
    }
    doc = blankDocument(cb.author);
    selection = null;
    dirty = false;
    history.length = 0;
    history.push(cloneDoc(doc));
    histIndex = 0;
    persistDraft();
    renderAll();
  });

  preview.querySelector("#load")!.addEventListener("click", () => openLoadModal());
  preview.querySelector("#save")!.addEventListener("click", () => {
    const map = documentToMapDef(doc);
    if (!map.id.startsWith("custom-")) map.id = `custom-${eid("m")}`;
    doc.id = map.id;
    upsertCustomMap(map);
    dirty = false;
    infoText = `Saved “${map.name}”`;
    persistDraft();
    renderAll();
    alert(`Saved map “${map.name}” locally.`);
  });
  preview.querySelector("#export")!.addEventListener("click", () => {
    const map = documentToMapDef(doc);
    const blob = new Blob([JSON.stringify(map, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${map.name.replace(/\s+/g, "_") || "map"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  preview.querySelector("#play")!.addEventListener("click", () => {
    const map = documentToMapDef(doc);
    if (!map.spawns.length) {
      alert("Add at least one spawn before playtesting.");
      return;
    }
    if (!map.id.startsWith("custom-")) map.id = `custom-${eid("m")}`;
    doc.id = map.id;
    upsertCustomMap(map);
    dirty = false;
    cb.onPlaytest(map);
  });
  preview.querySelector("#back")!.addEventListener("click", () => {
    if (dirty && !confirm("Leave editor? Unsaved changes stay in draft.")) return;
    cb.onBack();
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      view.zoom = clamp(view.zoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.4, 3);
      drawCanvas();
    },
    { passive: false },
  );

  const onKey = (e: KeyboardEvent) => {
    if (stateTyping(e)) return;
    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "y") {
      e.preventDefault();
      redo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      duplicateSelected();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteSelected();
    } else if (e.key === "g" || e.key === "G") {
      view.grid = !view.grid;
      renderAll();
    } else if (e.key === "v" || e.key === "V") {
      tool = "select";
      renderAll();
    } else if (e.key === "b" || e.key === "B") {
      tool = "box";
      renderAll();
    } else if (e.key === "c" || e.key === "C") {
      tool = "circle";
      renderAll();
    }
  };
  window.addEventListener("keydown", onKey);

  function openLoadModal() {
    const modal = document.createElement("div");
    modal.className = "editor-modal";
    const { builtin, custom } = listEditableMaps();
    modal.innerHTML = `
      <div class="editor-modal-card panel">
        <h3>Load Map</h3>
        <p class="ed-hint">Loading replaces the current editor document.</p>
        <div class="ed-load-list" id="load-list"></div>
        <div class="row" style="margin-top:10px">
          <label class="btn-brown small" style="display:inline-flex;align-items:center;justify-content:center;cursor:pointer">
            Import JSON
            <input type="file" id="import-json" accept="application/json,.json" hidden />
          </label>
          <button class="btn-brown small" id="cancel-load">Cancel</button>
        </div>
      </div>
    `;
    wrap.appendChild(modal);
    const list = modal.querySelector("#load-list")!;
    const addGroup = (title: string, maps: MapDef[], canDelete: boolean) => {
      const h = document.createElement("div");
      h.className = "ed-load-group";
      h.textContent = title;
      list.appendChild(h);
      for (const m of maps) {
        const row = document.createElement("div");
        row.className = "ed-load-row";
        row.innerHTML = `<button class="map-card" style="flex:1"><h4>${escape(m.name)}</h4><p>${escape(m.author)} · ${m.shapes.length} shapes</p></button>${canDelete ? `<button class="ed-icon danger" data-del="${m.id}" title="Delete">✕</button>` : ""}`;
        row.querySelector(".map-card")!.addEventListener("click", () => {
          doc = mapDefToDocument({
            ...structuredClone(m),
            id: m.id.startsWith("custom-") ? m.id : `custom-${eid("m")}`,
          });
          selection = null;
          dirty = false;
          history.length = 0;
          history.push(cloneDoc(doc));
          histIndex = 0;
          persistDraft();
          modal.remove();
          renderAll();
        });
        row.querySelector("[data-del]")?.addEventListener("click", () => {
          if (!confirm(`Delete saved map “${m.name}”?`)) return;
          deleteCustomMap(m.id);
          modal.remove();
          openLoadModal();
        });
        list.appendChild(row);
      }
    };
    addGroup("Built-in", builtin, false);
    addGroup("Saved", custom, true);
    if (!custom.length) {
      const empty = document.createElement("p");
      empty.className = "ed-hint";
      empty.textContent = "No saved custom maps yet.";
      list.appendChild(empty);
    }
    modal.querySelector("#cancel-load")!.addEventListener("click", () => modal.remove());
    modal.querySelector("#import-json")!.addEventListener("change", async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as MapDef;
        if (!parsed.shapes || !parsed.spawns) throw new Error("Invalid map JSON");
        parsed.id = `custom-${eid("m")}`;
        doc = mapDefToDocument(parsed);
        selection = null;
        dirty = true;
        history.length = 0;
        history.push(cloneDoc(doc));
        histIndex = 0;
        persistDraft();
        modal.remove();
        renderAll();
      } catch {
        alert("Could not import that JSON map.");
      }
    });
  }

  const onWinResize = () => drawCanvas();
  window.addEventListener("resize", onWinResize);
  const ro =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => drawCanvas())
      : null;
  ro?.observe(canvas);

  // First paint after layout so the canvas isn't stuck at a tiny default size.
  requestAnimationFrame(() => renderAll());
  renderAll();

  return () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onWinResize);
    ro?.disconnect();
    wrap.remove();
  };
}

function restoreOrBlank(author: string): EditorDocument {
  const draft = loadDraftJson();
  if (draft) {
    try {
      const map = JSON.parse(draft) as MapDef;
      if (map?.shapes) return mapDefToDocument(map);
    } catch {
      /* fall through */
    }
  }
  return blankDocument(author);
}

function spawnColor(s: EditorSpawn): string {
  const flags = [s.ffa, s.red, s.blue, s.green, s.yellow];
  if (!flags.some(Boolean)) return "#888";
  if (s.ffa && !s.red && !s.blue && !s.green && !s.yellow) return "#1abc9c";
  if (s.red && !s.blue && !s.green && !s.yellow && !s.ffa) return "#e74c3c";
  if (s.blue && !s.red && !s.green && !s.yellow && !s.ffa) return "#3498db";
  if (s.green && !s.red && !s.blue && !s.yellow && !s.ffa) return "#2ecc71";
  if (s.yellow && !s.red && !s.blue && !s.green && !s.ffa) return "#f1c40f";
  return "#9b59b6";
}

function fillSwatches(host: Element, onPick: (c: string) => void, active?: string) {
  host.innerHTML = "";
  for (const c of COLOR_PALETTE) {
    const b = document.createElement("button");
    b.className = "swatch" + (c === active ? " active" : "");
    b.style.background = c;
    b.addEventListener("click", () => onPick(c));
    host.appendChild(b);
  }
}

function mapPropsHtml(doc: EditorDocument): string {
  return `
    <h4>Map Properties</h4>
    <div class="field"><label>Name</label><input id="mp-name" value="${escapeAttr(doc.name)}" /></div>
    <div class="field"><label>Author</label><input id="mp-author" value="${escapeAttr(doc.author)}" /></div>
    <div class="field"><label>Mode hint</label>
      <select id="mp-mode">
        ${(["any", "classic", "arrows", "deatharrows", "grapple", "football"] as const)
          .map((m) => `<option value="${m}" ${doc.modeHint === m ? "selected" : ""}>${m}</option>`)
          .join("")}
      </select>
    </div>
    <div class="field"><label>Map size preset</label>
      <select id="mp-size">
        <option value="small">Smallest</option>
        <option value="regular" selected>Regular</option>
        <option value="big">Biggest</option>
      </select>
    </div>
    <div class="ed-grid2">
      <div class="field"><label>Width</label><input id="mp-w" type="number" value="${doc.width}" /></div>
      <div class="field"><label>Height</label><input id="mp-h" type="number" value="${doc.height}" /></div>
      <div class="field"><label>Gravity X</label><input id="mp-gx" type="number" step="1" value="${doc.gravityX}" /></div>
      <div class="field"><label>Gravity Y</label><input id="mp-gy" type="number" step="1" value="${doc.gravityY}" title="Box2D units; real bonk uses 20" /></div>
      <div class="field"><label>Kill Y</label><input id="mp-killy" type="number" value="${doc.killY}" /></div>
      <div class="field"><label>Kill pad</label><input id="mp-pad" type="number" value="${doc.killPadding}" /></div>
    </div>
  `;
}

function platformPropsHtml(p: EditorPlatform): string {
  return `
    <h4>Platform</h4>
    <div class="field"><label>Name</label><input id="pp-name" value="${escapeAttr(p.name)}" /></div>
    <div class="field"><label>Move Type</label>
      <select id="pp-move">
        <option value="stationary" ${p.moveType === "stationary" ? "selected" : ""}>Stationary</option>
        <option value="free" ${p.moveType === "free" ? "selected" : ""}>Free Moving</option>
        <option value="rotate" ${p.moveType === "rotate" ? "selected" : ""}>Rotating (pivot)</option>
      </select>
    </div>
    <div class="ed-grid2">
      <div class="field"><label>X</label><input id="pp-x" type="number" value="${Math.round(p.x)}" /></div>
      <div class="field"><label>Y</label><input id="pp-y" type="number" value="${Math.round(p.y)}" /></div>
      ${
        p.type === "circle"
          ? `<div class="field"><label>Radius</label><input id="pp-r" type="number" value="${Math.round(p.r)}" /></div>`
          : p.type === "box"
            ? `<div class="field"><label>Width</label><input id="pp-w" type="number" value="${Math.round(p.w)}" /></div>
               <div class="field"><label>Height</label><input id="pp-h" type="number" value="${Math.round(p.h)}" /></div>`
            : `<div class="field"><label>Verts</label><input disabled value="${p.vertices.length}" /></div>`
      }
      <div class="field"><label>Angle</label><input id="pp-angle" type="number" value="${p.angle}" /></div>
      <div class="field"><label>Bounciness</label><input id="pp-bounce" type="number" step="0.05" value="${p.restitution}" /></div>
      <div class="field"><label>Density</label><input id="pp-dens" type="number" step="0.01" value="${p.density}" title="Box2D density; blank maps ~0.3" /></div>
      <div class="field"><label>Friction</label><input id="pp-fric" type="number" step="0.05" value="${p.friction}" /></div>
    </div>
    <label class="ed-check"><input type="checkbox" id="pp-death" ${p.death ? "checked" : ""}/> Death</label>
    <label class="ed-check"><input type="checkbox" id="pp-nophys" ${p.noPhysics ? "checked" : ""}/> No Physics</label>
    <label class="ed-check"><input type="checkbox" id="pp-fricp" ${p.fricPlayers ? "checked" : ""}/> Fric Players</label>
    <label class="ed-check"><input type="checkbox" id="pp-fixrot" ${p.fixedRotation ? "checked" : ""}/> Fixed Rotation</label>
    <details class="ed-section" ${p.moveType === "rotate" ? "open" : ""}>
      <summary>Pivot</summary>
      <p class="ed-hint">Yellow crosshair on the preview is the rotate pivot. Drag it, or set local offsets here.</p>
      <div class="ed-grid2">
        <div class="field"><label>Pivot X</label><input id="pp-pivx" type="number" value="${Math.round(p.pivotX)}" /></div>
        <div class="field"><label>Pivot Y</label><input id="pp-pivy" type="number" value="${Math.round(p.pivotY)}" /></div>
      </div>
      <button class="btn-brown small" id="pp-piv-center" type="button">Center Pivot</button>
    </details>
    <details class="ed-section" ${p.moveType !== "stationary" ? "open" : ""}>
      <summary>Movement</summary>
      <div class="ed-grid2">
        <div class="field"><label>Start Speed X</label><input id="pp-ssx" type="number" step="0.1" value="${p.startSpeedX}" /></div>
        <div class="field"><label>Start Speed Y</label><input id="pp-ssy" type="number" step="0.1" value="${p.startSpeedY}" /></div>
        <div class="field"><label>Start Spin</label><input id="pp-spin" type="number" step="0.01" value="${p.startSpin}" /></div>
        <div class="field"><label>Ang. Damp</label><input id="pp-adamp" type="number" step="0.01" value="${p.angularDamping}" /></div>
      </div>
    </details>
    <div class="field"><label>Color</label><div class="swatches" id="pp-swatches"></div></div>
    <div class="row" style="margin-top:8px">
      <button class="btn-brown small" id="pp-dup-invx">Dup Invert X</button>
      <button class="btn-brown small" id="pp-dup-invy">Dup Invert Y</button>
      <button class="btn-brown small" id="pp-delete" type="button">Delete</button>
    </div>
    <p class="ed-hint">Shape type: ${p.type.toUpperCase()} · Del deletes · Ctrl+D duplicates</p>
  `;
}

function spawnPropsHtml(s: EditorSpawn): string {
  return `
    <h4>Spawn</h4>
    <div class="ed-grid2">
      <div class="field"><label>X</label><input id="sp-x" type="number" value="${Math.round(s.x)}" /></div>
      <div class="field"><label>Y</label><input id="sp-y" type="number" value="${Math.round(s.y)}" /></div>
      <div class="field"><label>Start Speed X</label><input id="sp-ssx" type="number" step="0.1" value="${s.startSpeedX}" /></div>
      <div class="field"><label>Start Speed Y</label><input id="sp-ssy" type="number" step="0.1" value="${s.startSpeedY}" /></div>
      <div class="field"><label>Priority</label><input id="sp-pri" type="number" value="${s.priority}" /></div>
    </div>
    <p class="ed-hint">Team uses</p>
    <label class="ed-check"><input type="checkbox" id="sp-ffa" ${s.ffa ? "checked" : ""}/> FFA</label>
    <label class="ed-check"><input type="checkbox" id="sp-red" ${s.red ? "checked" : ""}/> Red</label>
    <label class="ed-check"><input type="checkbox" id="sp-blue" ${s.blue ? "checked" : ""}/> Blue</label>
    <label class="ed-check"><input type="checkbox" id="sp-green" ${s.green ? "checked" : ""}/> Green</label>
    <label class="ed-check"><input type="checkbox" id="sp-yellow" ${s.yellow ? "checked" : ""}/> Yellow</label>
    <div class="row" style="margin-top:8px">
      <button class="btn-brown small" id="sp-delete" type="button">Delete</button>
    </div>
  `;
}

function capPropsHtml(z: EditorCapZone): string {
  return `
    <h4>Capture Zone</h4>
    <div class="field"><label>Name</label><input id="cz-name" value="${escapeAttr(z.name)}" /></div>
    <div class="field"><label>Shape</label>
      <select id="cz-type">
        <option value="circle" ${z.type === "circle" ? "selected" : ""}>Circle</option>
        <option value="box" ${z.type === "box" ? "selected" : ""}>Box</option>
      </select>
    </div>
    <div class="ed-grid2">
      <div class="field"><label>X</label><input id="cz-x" type="number" value="${Math.round(z.x)}" /></div>
      <div class="field"><label>Y</label><input id="cz-y" type="number" value="${Math.round(z.y)}" /></div>
      <div class="field"><label>Width</label><input id="cz-w" type="number" value="${Math.round(z.w)}" /></div>
      <div class="field"><label>Height</label><input id="cz-h" type="number" value="${Math.round(z.h)}" /></div>
      <div class="field"><label>Radius</label><input id="cz-r" type="number" value="${Math.round(z.r)}" /></div>
    </div>
    <p class="ed-hint">Capture zones are stored with the map (visual/editor support).</p>
    <div class="row" style="margin-top:8px">
      <button class="btn-brown small" id="cz-delete" type="button">Delete</button>
    </div>
  `;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function escapeAttr(s: string) {
  return escape(s);
}

function stateTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}
