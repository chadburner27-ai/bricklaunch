/// <reference lib="webworker" />
// Lua2Code sandbox worker. Runs untrusted user Lua (wasmoon / Lua 5.4 in WASM)
// fully isolated from the DOM. Scripts are coroutines scheduled by __tick();
// wait(t) yields, so a well-behaved script never blocks. A runaway script can
// only hang this worker — the main thread terminates it on Stop.
import { LuaFactory } from "wasmoon";
import wasmUrl from "wasmoon/dist/glue.wasm?url";
import type { PartData } from "@launcher/shared";
import type { MainToWorker, WorkerToMain } from "./protocol";

const post = (m: WorkerToMain) => (self as unknown as Worker).postMessage(m);

let parts = new Map<string, PartData>();
let createdCounter = 0;
let fireTouched: ((id: string, byName: string) => void) | null = null;

self.onmessage = (e: MessageEvent<MainToWorker>) => {
  if (e.data.type === "start") {
    boot(e.data.parts, e.data.scripts, e.data.localName ?? "guest").catch((err) =>
      post({ type: "error", text: `Lua VM failed to start: ${err}` })
    );
  } else if (e.data.type === "touched") {
    fireTouched?.(e.data.id, e.data.byName);
  }
};

async function boot(
  initialParts: PartData[],
  scripts: { name: string; source: string }[],
  localName: string
) {
  parts = new Map(initialParts.map((p) => [p.id, { ...p }]));

  const factory = new LuaFactory(wasmUrl);
  const lua = await factory.createEngine();
  lua.global.set("__localName", localName);
  lua.global.set("js_listenTouched", (id: string) => post({ type: "listen", id }));
  lua.global.set("js_teleport", (x: number, y: number, z: number) =>
    post({ type: "teleport", x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0 })
  );

  // ---- curated JS bridge (the ONLY surface user code can reach) ------------
  lua.global.set("js_print", (s: unknown) => post({ type: "print", text: String(s) }));
  lua.global.set("js_error", (s: unknown) => post({ type: "error", text: String(s) }));

  lua.global.set("js_find", (name: string) => {
    for (const p of parts.values()) if (p.name === name) return p.id;
    return undefined; // -> nil
  });

  lua.global.set("js_get", (id: string, prop: string): string => {
    const p = parts.get(id);
    if (!p) return "";
    switch (prop) {
      case "position": return p.position.join(",");
      case "rotation": return p.rotation.join(",");
      case "size": return p.size.join(",");
      case "color": return p.color;
      case "name": return p.name;
      default: return "";
    }
  });

  lua.global.set("js_set", (id: string, prop: string, a: unknown, b: unknown, c: unknown) => {
    const p = parts.get(id);
    if (!p) return;
    if (prop === "color" && typeof a === "string") {
      p.color = a;
      post({ type: "patch", id, props: { color: a } });
    } else if (prop === "name" && typeof a === "string") {
      p.name = a;
      post({ type: "patch", id, props: { name: a } });
    } else if (prop === "position" || prop === "rotation" || prop === "size") {
      const v: [number, number, number] = [Number(a) || 0, Number(b) || 0, Number(c) || 0];
      p[prop] = v;
      post({ type: "patch", id, props: { [prop]: v } });
    }
  });

  lua.global.set("js_create", (shape: string): string => {
    createdCounter += 1;
    const id = `lua_${createdCounter}`;
    const part: PartData = {
      id,
      name: `LuaPart${createdCounter}`,
      shape: (["box", "sphere", "cylinder", "wedge"].includes(shape) ? shape : "box") as PartData["shape"],
      position: [0, 5, 0],
      size: [2, 2, 2],
      rotation: [0, 0, 0],
      color: "#a3a7b0",
      anchored: true,
      material: "plastic",
    };
    parts.set(id, part);
    post({ type: "create", part: { ...part } });
    return id;
  });

  lua.global.set("js_destroy", (id: string) => {
    if (parts.delete(id)) post({ type: "destroy", id });
  });

  await lua.doString(PRELUDE);

  const addScript = lua.global.get("__addScript") as (name: string, src: string) => void;
  for (const s of scripts) addScript(s.name, s.source);

  const luaFireTouched = lua.global.get("__fireTouched") as (id: string, byName: string) => void;
  fireTouched = (id, byName) => {
    try {
      luaFireTouched(id, byName);
    } catch (err) {
      post({ type: "error", text: `Touched: ${err}` });
    }
  };

  post({ type: "ready" });

  const tick = lua.global.get("__tick") as (dt: number) => void;
  const DT = 1 / 30;
  setInterval(() => {
    try {
      tick(DT);
    } catch (err) {
      post({ type: "error", text: `tick: ${err}` });
    }
  }, 1000 * DT);
}

// The Lua-side world: Vector3/Color3 values, part proxies, workspace,
// Instance.new, print, wait/spawn, and the coroutine scheduler.
const PRELUDE = `
-- sandbox: cut off anything dangerous
os = nil; io = nil; package = nil; require = nil; dofile = nil; loadfile = nil; debug = nil

local VecMT
VecMT = {
  __add = function(a, b) return Vector3.new(a.X + b.X, a.Y + b.Y, a.Z + b.Z) end,
  __sub = function(a, b) return Vector3.new(a.X - b.X, a.Y - b.Y, a.Z - b.Z) end,
  __mul = function(a, b)
    if type(b) == "number" then return Vector3.new(a.X * b, a.Y * b, a.Z * b) end
    return Vector3.new(a.X * b.X, a.Y * b.Y, a.Z * b.Z)
  end,
  __tostring = function(v) return v.X .. ", " .. v.Y .. ", " .. v.Z end,
}
Vector3 = {
  new = function(x, y, z) return setmetatable({ X = x or 0, Y = y or 0, Z = z or 0 }, VecMT) end,
}

Color3 = {
  fromRGB = function(r, g, b)
    return string.format("#%02x%02x%02x",
      math.floor(math.max(0, math.min(255, r or 0))),
      math.floor(math.max(0, math.min(255, g or 0))),
      math.floor(math.max(0, math.min(255, b or 0))))
  end,
}

local function parseVec(s)
  local x, y, z = s:match("([^,]+),([^,]+),([^,]+)")
  return Vector3.new(tonumber(x) or 0, tonumber(y) or 0, tonumber(z) or 0)
end

local partCache = {}
__touchedHandlers = {}
local function makeTouchedSignal(id)
  return {
    Connect = function(_, fn)
      if type(fn) ~= "function" then return end
      __touchedHandlers[id] = __touchedHandlers[id] or {}
      table.insert(__touchedHandlers[id], fn)
      js_listenTouched(id)
    end,
  }
end

local PartMT = {
  __index = function(self, k)
    local id = rawget(self, "__id")
    if k == "Position" then return parseVec(js_get(id, "position"))
    elseif k == "Rotation" then return parseVec(js_get(id, "rotation"))
    elseif k == "Size" then return parseVec(js_get(id, "size"))
    elseif k == "Color" then return js_get(id, "color")
    elseif k == "Name" then return js_get(id, "name")
    elseif k == "Touched" then return makeTouchedSignal(id)
    elseif k == "Destroy" then
      return function(s)
        local pid = rawget(s, "__id")
        js_destroy(pid)
        partCache[pid] = nil
        __touchedHandlers[pid] = nil
      end
    end
    return nil
  end,
  __newindex = function(self, k, v)
    local id = rawget(self, "__id")
    if k == "Position" then js_set(id, "position", v.X, v.Y, v.Z)
    elseif k == "Rotation" then js_set(id, "rotation", v.X, v.Y, v.Z)
    elseif k == "Size" then js_set(id, "size", v.X, v.Y, v.Z)
    elseif k == "Color" then js_set(id, "color", v)
    elseif k == "Name" then js_set(id, "name", v)
    end
  end,
}
local function makePart(id)
  if not partCache[id] then partCache[id] = setmetatable({ __id = id }, PartMT) end
  return partCache[id]
end

workspace = {
  FindFirstChild = function(_, name)
    local id = js_find(name)
    if id then return makePart(id) end
    return nil
  end,
}

Instance = {
  new = function(cls)
    local shape = "box"
    if cls == "Sphere" or cls == "Ball" then shape = "sphere"
    elseif cls == "Cylinder" then shape = "cylinder"
    elseif cls == "Wedge" then shape = "wedge" end
    return makePart(js_create(shape))
  end,
}

Players = {
  LocalPlayer = {
    Name = __localName or "guest",
    Teleport = function(_, v)
      js_teleport(v.X or 0, v.Y or 0, v.Z or 0)
    end,
  },
}

print = function(...)
  local out = {}
  for i = 1, select("#", ...) do out[#out + 1] = tostring(select(i, ...)) end
  js_print(table.concat(out, "  "))
end

-- cooperative scheduler -------------------------------------------------------
__tasks = {}
__now = 0

function wait(t) coroutine.yield(t or 0.03) end

function spawn(fn)
  table.insert(__tasks, { co = coroutine.create(fn), wake = 0, name = "spawn" })
end

function __addScript(name, src)
  local fn, err = load(src, "@" .. name)
  if not fn then
    js_error(name .. ": " .. tostring(err))
    return
  end
  table.insert(__tasks, { co = coroutine.create(fn), wake = 0, name = name })
end

function __tick(dt)
  __now = __now + dt
  for _, t in ipairs(__tasks) do
    if coroutine.status(t.co) == "suspended" and __now >= t.wake then
      local ok, res = coroutine.resume(t.co)
      if not ok then
        js_error(t.name .. ": " .. tostring(res))
      elseif type(res) == "number" then
        t.wake = __now + res
      end
    end
  end
end

-- Called from JS when the main thread detects a player touching a part.
-- Each handler runs as its own coroutine so it can wait() freely.
function __fireTouched(id, byName)
  local hs = __touchedHandlers[id]
  if not hs then return end
  local hit = { Name = byName }
  for _, fn in ipairs(hs) do
    local co = coroutine.create(fn)
    local ok, res = coroutine.resume(co, hit)
    if not ok then
      js_error("Touched: " .. tostring(res))
    elseif coroutine.status(co) == "suspended" then
      local wake = (type(res) == "number") and (__now + res) or __now
      table.insert(__tasks, { co = co, wake = wake, name = "touched" })
    end
  end
end
`;
