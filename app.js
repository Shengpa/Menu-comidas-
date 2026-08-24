/* ---------- Constantes ---------- */
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const DIAS_SEMANA = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
const BASE_SERVINGS = 4;
const SERVING_OPTIONS = [2, 4, 6];

const CATS = [
  { name: "Verdulería", keys: ["cebolla","zanahoria","papa","tomate","lechuga","morrón","pimiento","ajo","perejil","limón","manzana","banana","zapallo","choclo","espinaca","acelga","puerro","apio","rúcula","palta","batata","brócoli","zapallito","berenjena"] },
  { name: "Carnes y pescados", keys: ["pollo","carne","cerdo","bife","milanesa","pescado","atún","salmón","cordero","panceta","chorizo","molida","pechuga","costilla","merluza","camarón","langostino","jamón"] },
  { name: "Lácteos y huevos", keys: ["leche","queso","yogur","manteca","crema","huevo","ricota","muzzarella","mozzarella"] },
  { name: "Panificados", keys: ["pan rallado","pan","tapa de tarta","masa","tortilla de trigo"] },
  { name: "Almacén", keys: ["harina","azúcar","sal","aceite","arroz","fideos","salsa de soja","vinagre","mostaza","mayonesa","lata","arvejas","puré de tomate","caldo","avena","semilla","lenteja","garbanzo","poroto","coco","curry","especia","orégano","pimienta","vino"] },
];

const MODEL = "claude-sonnet-5";
const GEMINI_MODEL = "gemini-3.6-flash";

/* ---------- Estado ---------- */
let state = {
  loading: true,
  generating: false,
  generatingDay: null,
  error: null,
  today: new Date(),
  range: null,
  current: null,
  recentWeeks: [],
  checklist: {},
  favorites: new Set(),
  restrictions: "",
  expandedDay: null,
  expandedBeforePrint: null,
  showHistory: false,
  showSettings: false,
  confirmRegen: false,
  apiKey: localStorage.getItem("menuApp_apiKey") || "",
  geminiKey: localStorage.getItem("menuApp_geminiKey") || "",
  pexelsKey: localStorage.getItem("menuApp_pexelsKey") || "",
  servings: parseInt(localStorage.getItem("menuApp_servings") || "4", 10),
  copyFeedback: null,
  showManualPromptFallback: null,
  imageWarning: null,
  lastImageError: null,
  pexelsTestResult: null,
};

/* ---------- Utilidades ---------- */
function getWeekRange(baseDate) {
  const d = new Date(baseDate);
  const day = d.getDay();
  const diffToMonday = day === 0 ? 1 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const sameMonth = monday.getMonth() === friday.getMonth();
  const label = sameMonth
    ? `${monday.getDate()} al ${friday.getDate()} de ${MESES[monday.getMonth()]}`
    : `${monday.getDate()} de ${MESES[monday.getMonth()]} al ${friday.getDate()} de ${MESES[friday.getMonth()]}`;
  const mondayISO = monday.toISOString().slice(0, 10);
  return { label, mondayISO };
}

function formatHoy(d) {
  return `${DIAS_SEMANA[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "plato";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- Escalado de porciones ---------- */
function scaleQty(qty, unit) {
  const factor = state.servings / BASE_SERVINGS;
  let val = (Number(qty) || 0) * factor;
  if (unit === "g" || unit === "ml") val = Math.round(val / 5) * 5;
  else if (unit === "kg" || unit === "l") val = Math.round(val * 10) / 10;
  else val = Math.round(val * 2) / 2;
  return Number.isInteger(val) ? val : val.toFixed(1);
}

function formatIngredient(ing) {
  const val = scaleQty(ing.qty, ing.unit);
  return ing.unit ? `${val} ${ing.unit} de ${ing.name}` : `${val} ${ing.name}`;
}

/* ---------- Categorización / lista de compras ---------- */
function categorize(name) {
  const t = name.toLowerCase();
  for (const cat of CATS) {
    if (cat.keys.some((k) => t.includes(k))) return cat.name;
  }
  return "Otros";
}

function buildShoppingList(current) {
  if (!current) return {};
  const map = new Map();
  (current.days || []).forEach((d) => {
    (d.ingredients || []).forEach((ing) => {
      const key = ing.name.toLowerCase() + "|" + (ing.unit || "");
      if (!map.has(key)) map.set(key, { name: ing.name, unit: ing.unit || "", qty: 0, days: new Set() });
      const entry = map.get(key);
      entry.qty += Number(ing.qty) || 0;
      entry.days.add(d.day);
    });
  });
  const grouped = {};
  map.forEach((entry) => {
    const cat = categorize(entry.name);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(entry);
  });
  return grouped;
}

function shoppingListAsText(current) {
  const grouped = buildShoppingList(current);
  let out = `🛒 Lista de compras — semana del ${current.weekRangeLabel}\n\n`;
  Object.entries(grouped).forEach(([cat, items]) => {
    out += `*${cat}*\n`;
    items.forEach((item) => { out += `- ${formatIngredient(item)}\n`; });
    out += "\n";
  });
  return out;
}

/* ---------- Prompts ---------- */
function ingredientFormatSpec() {
  return `"ingredients": [{"qty": 600, "unit": "g", "name": "pechuga de pollo"}, {"qty": 2, "unit": "", "name": "cebollas"}, ...] — "unit" puede ser "g","kg","ml","l","cda","cdita","taza" o "" (cadena vacía) para unidades enteras como "2 cebollas" o "3 huevos" (en ese caso "name" va en plural, ya listo para mostrar tal cual)`;
}

function restrictionsLine() {
  return state.restrictions?.trim()
    ? `Restricciones o preferencias del usuario que SIEMPRE tenés que respetar: ${state.restrictions.trim()}.`
    : "";
}

function buildWeekPrompt(previousDishes, favoriteDishes, weekLabel) {
  const avoid = previousDishes.length
    ? `Platos que YA se hicieron en semanas anteriores y NO tenés que repetir (ni versiones muy parecidas): ${previousDishes.join(", ")}.`
    : "Todavía no hay platos previos, es la primera semana.";
  const favLine = favoriteDishes.length
    ? `Estos son platos favoritos del usuario: podés repetir COMO MUCHO UNO de ellos esta semana si encaja bien, aunque haya salido antes: ${favoriteDishes.join(", ")}.`
    : "";
  const system = `Sos un asistente que arma menús semanales caseros para una familia en Argentina. Respondé ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, sin markdown, sin comentarios. Las recetas son para 4 porciones exactas, sin restricciones alimentarias salvo que se indique lo contrario. Priorizá variedad real: no repitas la misma proteína ni la misma técnica de cocción dos días seguidos, y mezclá clásicos caseros argentinos (milanesas, tartas, guisos, pastas caseras, salteados, platos al horno) con comida internacional simple y fácil de conseguir en un supermercado argentino común (wok, curry suave, tacos, pasta italiana, comida asiática fácil). Instrucciones de cocción claras, en pasos cortos y numerados. ${restrictionsLine()}`;
  const user = `Generá el menú de 5 días (Lunes a Viernes) para la semana del ${weekLabel}. ${avoid} ${favLine}
Devolvé exactamente este formato JSON (sin explicaciones fuera del JSON):
{
  "days": [
    {"day": "Lunes", "category": "2-3 palabras que describan el plato", "dish": "nombre del plato", "prep_minutes": 40, ${ingredientFormatSpec()}, "steps": ["paso corto 1", "paso corto 2"]},
    ... (uno por cada día, Lunes a Viernes)
  ],
  "comodin": {"dish": "plato de emergencia rapidísimo, menos de 15 minutos", "note": "por qué sirve para un día caótico", ${ingredientFormatSpec()}, "steps": ["paso corto 1", "paso corto 2"]},
  "tip": "un consejo de cocina corto y útil para la semana"
}
Cada receta de los 5 días: 6 a 9 ingredientes, y 4 a 6 pasos cortos (una oración cada uno, sin números adentro del texto). El comodín: 3 a 5 ingredientes que probablemente ya haya en casa, y 2 a 4 pasos cortos.`;
  return { system, user };
}

function buildSingleDayPrompt(day, weekLabel, otherDishes, previousDishes, favoriteDishes) {
  const avoidAll = [...otherDishes, ...previousDishes];
  const avoid = avoidAll.length ? `Platos que NO tenés que usar (ya están en esta semana o en semanas anteriores): ${avoidAll.join(", ")}.` : "";
  const favLine = favoriteDishes.length ? `Si encaja bien, podés elegir uno de estos favoritos: ${favoriteDishes.join(", ")}.` : "";
  const system = `Sos un asistente que arma menús caseros para una familia en Argentina. Respondé ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, sin markdown. La receta es para 4 porciones exactas. ${restrictionsLine()}`;
  const user = `Necesito UN plato nuevo y distinto para reemplazar el de ${day} de la semana del ${weekLabel}. ${avoid} ${favLine}
Devolvé exactamente este formato JSON:
{"category": "2-3 palabras", "dish": "nombre del plato", "prep_minutes": 40, ${ingredientFormatSpec()}, "steps": ["paso corto 1", "..."]}
6 a 9 ingredientes, 4 a 6 pasos cortos.`;
  return { system, user };
}

function buildChatPromptText(weekLabel, previousDishes, favoriteDishes) {
  const { system, user } = buildWeekPrompt(previousDishes, favoriteDishes, weekLabel);
  return `${system}\n\n${user}`;
}

/* ---------- Llamada a la API ---------- */
function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Sin JSON en la respuesta");
  return text.slice(start, end + 1);
}

async function callClaude(system, user) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": state.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, system, messages: [{ role: "user", content: user }] }),
  });
  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`API respondió ${response.status}: ${errBody.slice(0, 200)}`);
  }
  const data = await response.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

async function callGemini(system, user) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": state.geminiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`Gemini respondió ${response.status}: ${errBody.slice(0, 200)}`);
  }
  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("");
}

// Preferimos Gemini porque es gratis; si no hay key de Gemini, usamos Anthropic (de pago).
function activeProvider() {
  if (state.geminiKey) return "gemini";
  if (state.apiKey) return "anthropic";
  return null;
}
function hasProviderKey() {
  return !!activeProvider();
}
async function callAI(system, user) {
  const provider = activeProvider();
  if (provider === "gemini") return callGemini(system, user);
  if (provider === "anthropic") return callClaude(system, user);
  throw new Error("Falta configurar una API key (Gemini o Anthropic).");
}

/* ---------- Fotos de los platos ---------- */
// Por defecto se genera una ilustración con IA (Pollinations.ai) para cada plato: no hace
// falta ninguna key ni configuración, es gratis y siempre funciona. Si el usuario carga una
// key de Pexels, se usa una foto real en su lugar (y si Pexels falla, cae de nuevo a la IA).
function pollinationsImageUrl(dish) {
  const prompt = `${dish}, comida casera argentina servida en un plato, fotografía de comida realista y apetitosa, luz natural, vista cenital`;
  const seed = Math.abs(Array.from(dish).reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=640&height=400&nologo=true&model=flux&seed=${seed}`;
}

// Pexels tiene mucho mejor cobertura de fotografía genérica en inglés que de nombres
// puntuales de platos argentinos. Primero probamos con el TIPO de plato (más distintivo
// visualmente: un curry no se parece a un pollo asado aunque los dos lleven pollo) y
// recién si no hay match probamos con la proteína principal sola.
const DISH_TYPE_EN = [
  ["milanesa", "schnitzel breaded cutlet"], ["empanadas", "empanadas"], ["pizza", "pizza"],
  ["tarta", "savory pie quiche"], ["risotto", "risotto"], ["guiso", "beef stew"],
  ["curry", "curry rice"], ["tacos", "tacos mexican food"], ["ensalada", "fresh salad"],
  ["sopa", "soup"], ["wok", "stir fry noodles"], ["asado", "grilled meat barbecue"],
  ["pot pie", "chicken pot pie"], ["lentejas", "lentil stew"], ["garbanzos", "chickpea stew"],
  ["salteado", "stir fry"], ["canelones", "cannelloni pasta baked"], ["lasaña", "lasagna"],
  ["ñoquis", "gnocchi"], ["ravioles", "ravioli pasta"], ["tallarines", "fettuccine pasta"],
  ["spaghetti", "spaghetti"], ["espaguetis", "spaghetti"], ["pastel de papa", "shepherd's pie"],
  ["hamburguesa", "burger"], ["sándwich", "sandwich"], ["paella", "paella"],
  ["fajitas", "fajitas"], ["horno", "roasted oven dish"],
];

const PROTEIN_EN = [
  ["pechuga de pollo", "grilled chicken breast"], ["pollo", "roast chicken"],
  ["bife", "beef steak"], ["carne picada", "ground beef"], ["carne", "beef"],
  ["cerdo", "pork"], ["costillita", "pork ribs"], ["chorizo", "sausage"],
  ["panceta", "bacon"], ["merluza", "white fish fillet"], ["salmón", "salmon fillet"],
  ["atún", "tuna"], ["camarón", "shrimp"], ["langostino", "shrimp"], ["cordero", "lamb"],
  ["pescado", "fish fillet"], ["fideos", "pasta"], ["pasta", "italian pasta"],
  ["arroz", "rice dish"],
];

function guessImageQuery(dish, category) {
  const text = `${dish} ${category || ""}`.toLowerCase();
  for (const [es, en] of DISH_TYPE_EN) {
    if (text.includes(es)) return en;
  }
  for (const [es, en] of PROTEIN_EN) {
    if (text.includes(es)) return en;
  }
  return null;
}

async function fetchPexelsImage(dish, category) {
  const tryQuery = async (q) => {
    try {
      const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=1&orientation=landscape`, {
        headers: { Authorization: state.pexelsKey },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(`Pexels respondió ${res.status} para "${q}": ${body.slice(0, 200)}`);
        state.lastImageError = `Pexels respondió ${res.status}${res.status === 401 ? " (key inválida)" : ""}`;
        return null;
      }
      const data = await res.json();
      return data.photos?.[0]?.src?.medium || null;
    } catch (e) {
      console.warn(`Fallo de red buscando imagen para "${q}":`, e);
      state.lastImageError = e?.message || "fallo de red";
      return null;
    }
  };
  const guessed = guessImageQuery(dish, category);
  if (guessed) {
    const found = await tryQuery(guessed);
    if (found) return found;
  }
  return (await tryQuery(`${dish} food`)) || (await tryQuery(dish));
}

async function fetchDishImage(dish, category) {
  if (state.pexelsKey) {
    const pexelsUrl = await fetchPexelsImage(dish, category);
    if (pexelsUrl) return pexelsUrl;
    // Pexels falló o no encontró nada: caemos a la imagen generada por IA igual.
  }
  return pollinationsImageUrl(dish);
}

async function attachImages(weekData) {
  await Promise.all((weekData.days || []).map(async (d) => {
    d.imageUrl = await fetchDishImage(d.dish, d.category);
  }));
  if (weekData.comodin) {
    weekData.comodin.imageUrl = await fetchDishImage(weekData.comodin.dish, null);
  }
  return weekData;
}

/* ---------- Firestore ---------- */
async function loadRecentWeeks() {
  const snap = await db.collection("weeks").orderBy("mondayISO", "desc").limit(16).get();
  return snap.docs.map((doc) => doc.data()).reverse();
}
async function loadWeek(mondayISO) {
  const doc = await db.collection("weeks").doc(mondayISO).get();
  return doc.exists ? doc.data() : null;
}
async function saveWeek(mondayISO, data) {
  await db.collection("weeks").doc(mondayISO).set(data);
}
async function loadChecklist(mondayISO) {
  const doc = await db.collection("checklists").doc(mondayISO).get();
  return doc.exists ? doc.data().items || {} : {};
}
async function saveChecklist(mondayISO, items) {
  await db.collection("checklists").doc(mondayISO).set({ items });
}
async function loadFavorites() {
  const snap = await db.collection("favorites").get();
  return new Set(snap.docs.map((d) => d.id));
}
async function toggleFavoriteDoc(slug, dish) {
  const ref = db.collection("favorites").doc(slug);
  if (state.favorites.has(slug)) await ref.delete();
  else await ref.set({ dish });
}
async function loadSettings() {
  const doc = await db.collection("meta").doc("settings").get();
  return doc.exists ? doc.data() : {};
}
async function saveRestrictions(text) {
  await db.collection("meta").doc("settings").set({ restrictions: text }, { merge: true });
}

function collectPreviousDishes() {
  return state.recentWeeks.flatMap((w) => {
    const d = (w.days || []).map((x) => x.dish);
    if (w.comodin?.dish) d.push(w.comodin.dish);
    return d;
  }).slice(-40);
}
function collectFavoriteDishNames() {
  const names = [];
  state.recentWeeks.forEach((w) => (w.days || []).forEach((d) => {
    if (state.favorites.has(slugify(d.dish))) names.push(d.dish);
  }));
  if (state.current) {
    (state.current.days || []).forEach((d) => {
      if (state.favorites.has(slugify(d.dish)) && !names.includes(d.dish)) names.push(d.dish);
    });
  }
  return names;
}

/* ---------- Generación semana completa ---------- */
async function generateWeek(range) {
  const previousDishes = collectPreviousDishes();
  const favoriteDishes = collectFavoriteDishNames();
  const { system, user } = buildWeekPrompt(previousDishes, favoriteDishes, range.label);
  const text = await callAI(system, user);
  const parsed = JSON.parse(extractJson(text));
  if (!parsed.days || !parsed.days.length) throw new Error("Respuesta incompleta");
  const weekData = {
    weekRangeLabel: range.label,
    mondayISO: range.mondayISO,
    generatedAt: new Date().toISOString(),
    days: parsed.days,
    comodin: parsed.comodin || null,
    tip: parsed.tip || "",
  };
  await attachImages(weekData);
  await saveWeek(range.mondayISO, weekData);
  return weekData;
}

/* ---------- Regeneración de un solo día ---------- */
async function regenerateDay(dayName) {
  if (!state.current) return;
  state.generatingDay = dayName;
  render();
  try {
    const otherDishes = state.current.days.filter((d) => d.day !== dayName).map((d) => d.dish);
    const previousDishes = collectPreviousDishes();
    const favoriteDishes = collectFavoriteDishNames();
    const { system, user } = buildSingleDayPrompt(dayName, state.current.weekRangeLabel, otherDishes, previousDishes, favoriteDishes);
    const text = await callAI(system, user);
    const parsed = JSON.parse(extractJson(text));
    const newDay = { day: dayName, ...parsed };
    newDay.imageUrl = await fetchDishImage(newDay.dish, newDay.category);
    const idx = state.current.days.findIndex((d) => d.day === dayName);
    const updatedDays = [...state.current.days];
    updatedDays[idx] = newDay;
    const updated = { ...state.current, days: updatedDays };
    await saveWeek(updated.mondayISO, updated);
    state.current = updated;
    const rIdx = state.recentWeeks.findIndex((w) => w.mondayISO === updated.mondayISO);
    if (rIdx !== -1) state.recentWeeks[rIdx] = updated;
  } catch (e) {
    console.error(e);
    state.error = `No se pudo cambiar el plato de ${dayName}. Probá de nuevo.`;
  }
  state.generatingDay = null;
  render();
}

/* ---------- Carga inicial ---------- */
async function init() {
  state.today = new Date();
  state.range = getWeekRange(state.today);

  try { state.recentWeeks = await loadRecentWeeks(); } catch (e) { console.error(e); }
  try { state.favorites = await loadFavorites(); } catch (e) { console.error(e); }
  try {
    const settings = await loadSettings();
    state.restrictions = settings.restrictions || "";
  } catch (e) { console.error(e); }

  try {
    const existing = await loadWeek(state.range.mondayISO);
    if (existing) {
      state.current = existing;
    } else if (state.today.getDay() === 0 && hasProviderKey()) {
      state.generating = true;
      render();
      try {
        state.current = await generateWeek(state.range);
        state.recentWeeks = await loadRecentWeeks();
      } catch (e) {
        console.error(e);
        state.error = `No se pudo generar el menú automáticamente (${e?.message || "error desconocido"}). Probá con el botón manual.`;
      }
      state.generating = false;
    }
  } catch (e) {
    console.error(e);
    state.error = "No se pudo conectar con la base de datos.";
  }

  if (state.current) {
    try { state.checklist = await loadChecklist(state.current.mondayISO); } catch (e) { state.checklist = {}; }
    state.expandedDay = state.current.days?.[0]?.day || null;
  }

  state.loading = false;
  render();
}

/* ---------- Acciones ---------- */
async function onGenerateClick() {
  if (!hasProviderKey()) { state.showSettings = true; render(); return; }
  state.confirmRegen = false;
  state.generating = true;
  state.error = null;
  render();
  try {
    state.current = await generateWeek(state.range);
    state.recentWeeks = await loadRecentWeeks();
    state.checklist = {};
    state.expandedDay = state.current.days?.[0]?.day || null;
  } catch (e) {
    console.error(e);
    state.error = `No se pudo generar el menú (${e?.message || "error desconocido"}). Probá de nuevo en un momento.`;
  }
  state.generating = false;
  render();
}

async function onToggleCheck(key) {
  state.checklist = { ...state.checklist, [key]: !state.checklist[key] };
  render();
  try { await saveChecklist(state.current.mondayISO, state.checklist); } catch (e) { console.error(e); }
}

async function onToggleFavorite(dish) {
  const slug = slugify(dish);
  const next = new Set(state.favorites);
  if (next.has(slug)) next.delete(slug); else next.add(slug);
  state.favorites = next;
  render();
  try { await toggleFavoriteDoc(slug, dish); } catch (e) { console.error(e); }
}

function onSetServings(n) {
  state.servings = n;
  localStorage.setItem("menuApp_servings", String(n));
  render();
}

function onSaveApiKey(key) {
  state.apiKey = key.trim();
  localStorage.setItem("menuApp_apiKey", state.apiKey);
  render();
}

function onSaveGeminiKey(key) {
  state.geminiKey = key.trim();
  localStorage.setItem("menuApp_geminiKey", state.geminiKey);
  render();
}

function onSavePexelsKey(key) {
  state.pexelsKey = key.trim();
  localStorage.setItem("menuApp_pexelsKey", state.pexelsKey);
  render();
}

async function onTestPexels() {
  const key = document.getElementById("pexels-key-input").value.trim();
  state.pexelsTestResult = "Probando…";
  render();
  if (!key) {
    state.pexelsTestResult = "❌ El campo está vacío.";
    render();
    return;
  }
  try {
    const res = await fetch("https://api.pexels.com/v1/search?query=milanesas&per_page=1", {
      headers: { Authorization: key },
    });
    if (res.ok) {
      const data = await res.json();
      const found = data.photos?.length > 0;
      state.pexelsTestResult = found
        ? `✓ Funciona. Key: ${key.slice(0, 4)}…${key.slice(-4)} (${key.length} caracteres)`
        : "⚠️ La key es válida pero no devolvió resultados.";
    } else {
      const body = await res.text().catch(() => "");
      state.pexelsTestResult = `❌ Pexels respondió ${res.status}. Key probada: ${key.slice(0, 4)}…${key.slice(-4)} (${key.length} caracteres). ${body.slice(0, 150)}`;
    }
  } catch (e) {
    state.pexelsTestResult = `❌ Fallo de red: ${e?.message || "desconocido"}`;
  }
  render();
}

async function onSaveRestrictions(text) {
  state.restrictions = text;
  try { await saveRestrictions(text); } catch (e) { console.error(e); }
  render();
}

async function onCopyPromptForChat() {
  const previousDishes = collectPreviousDishes();
  const favoriteDishes = collectFavoriteDishNames();
  const text = buildChatPromptText(state.range.label, previousDishes, favoriteDishes);
  try {
    await navigator.clipboard.writeText(text);
    state.copyFeedback = "¡Copiado! Ahora pegalo en una conversación de Claude.ai.";
  } catch (e) {
    state.copyFeedback = "No se pudo copiar automáticamente. Mantené presionado el cuadro de abajo para copiarlo a mano.";
    state.showManualPromptFallback = text;
  }
  render();
  setTimeout(() => { state.copyFeedback = null; render(); }, 4000);
}

async function onApplyPastedMenu() {
  const raw = document.getElementById("pasted-menu-input").value;
  try {
    const parsed = JSON.parse(extractJson(raw));
    if (!parsed.days || !parsed.days.length) throw new Error("Falta 'days' en el JSON pegado");
    const weekData = {
      weekRangeLabel: state.range.label,
      mondayISO: state.range.mondayISO,
      generatedAt: new Date().toISOString(),
      days: parsed.days,
      comodin: parsed.comodin || null,
      tip: parsed.tip || "",
    };
    await attachImages(weekData);
    await saveWeek(state.range.mondayISO, weekData);
    state.current = weekData;
    state.recentWeeks = await loadRecentWeeks();
    state.checklist = {};
    state.expandedDay = weekData.days?.[0]?.day || null;
    state.showSettings = false;
    state.error = null;
  } catch (e) {
    console.error(e);
    state.error = "Ese texto no tiene el JSON esperado. Pegá la respuesta completa que te dio Claude, tal cual.";
  }
  render();
}

function onShareWhatsapp() {
  if (!state.current) return;
  const text = shoppingListAsText(state.current);
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

function onDownloadPdf() {
  state.expandedBeforePrint = state.expandedDay;
  state.expandedDay = "ALL";
  render();
  setTimeout(() => window.print(), 80);
}
window.addEventListener("afterprint", () => {
  state.expandedDay = state.expandedBeforePrint;
  render();
});

/* ---------- Render ---------- */
function render() {
  const app = document.getElementById("app");
  const hoy = formatHoy(state.today);
  const esDomingo = state.today.getDay() === 0;

  let html = `<div class="wrap">`;

  html += `
    <div class="topbar no-print">
      <div class="stamp"><span>semana</span><strong>${state.recentWeeks.length + (state.current ? 1 : 0)}</strong></div>
      <div class="title-block">
        <h1>Menú del domingo</h1>
        <div class="subtitle">5 días de comida casera, distinta cada semana</div>
      </div>
      <button class="icon-btn" id="settings-btn" title="Configuración" aria-label="Configuración">⚙️</button>
    </div>
    <div class="print-title only-print">Menú del domingo — semana del ${state.current ? escapeHtml(state.current.weekRangeLabel) : ""}</div>
    <div class="today-line no-print">Hoy es ${hoy}${state.current ? ` · semana del ${escapeHtml(state.current.weekRangeLabel)}` : ""}</div>
  `;

  if (state.error) html += `<div class="error-box no-print">${escapeHtml(state.error)}</div>`;
  if (state.imageWarning) html += `<div class="error-box no-print">${escapeHtml(state.imageWarning)}</div>`;

  if (state.loading) {
    html += `<div class="empty">Cargando…</div>`;
  } else if (state.generating) {
    html += `<div class="empty">Armando el menú de la semana…</div>`;
  } else {
    html += `<div class="actions no-print">`;
    if (!state.current) {
      html += `<button class="btn-primary" id="generate-btn">Generar el menú de esta semana</button>`;
      if (!esDomingo) html += `<div class="hint">Todavía no hay menú generado para esta semana. Se genera solo los domingos; si querés, generalo ahora a mano (⚙️ tiene una opción gratis con Claude.ai).</div>`;
    } else if (!state.confirmRegen) {
      html += `<button class="btn-secondary" id="regen-btn">Regenerar esta semana</button>`;
    } else {
      html += `<span class="confirm-text">¿Reemplazar el menú actual?</span>
        <button class="btn-primary" id="generate-btn">Sí, generar</button>
        <button class="btn-secondary" id="cancel-regen-btn">Cancelar</button>`;
    }
    if (state.current) html += `<button class="btn-secondary" id="pdf-btn">Descargar / imprimir PDF</button>`;
    if (state.recentWeeks.length > 0) {
      html += `<button class="btn-secondary" id="history-btn">${state.showHistory ? "Ocultar historial" : `Ver semanas anteriores (${state.recentWeeks.length})`}</button>`;
    }
    html += `</div>`;

    if (state.current) {
      html += `<div class="servings-row no-print">
        <span>Porciones:</span>
        ${SERVING_OPTIONS.map((n) => `<button class="chip ${state.servings === n ? "chip-active" : ""}" data-servings="${n}">${n}</button>`).join("")}
      </div>`;
    }

    if (state.showHistory) {
      html += `<div class="card no-print"><div class="card-title">Ya hiciste</div>`;
      state.recentWeeks.slice().reverse().forEach((w) => {
        const dishes = (w.days || []).map((d) => d.dish).join(" · ");
        html += `<div class="hist-row"><span class="mono">${escapeHtml(w.weekRangeLabel)}:</span> ${escapeHtml(dishes)}</div>`;
      });
      html += `</div>`;
    }

    if (!state.current) {
      html += `<div class="empty">Todavía no hay un menú para mostrar.</div>`;
    } else {
      (state.current.days || []).forEach((d) => {
        const open = state.expandedDay === d.day || state.expandedDay === "ALL";
        const slug = slugify(d.dish);
        const isFav = state.favorites.has(slug);
        const isRegenerating = state.generatingDay === d.day;
        html += `
          <div class="day-card">
            <button class="day-head" data-day="${escapeHtml(d.day)}" aria-expanded="${open}">
              <span class="day-tag">${escapeHtml(d.day)}</span>
              <span class="day-info">
                <span class="day-cat">${escapeHtml(d.category || "")}</span>
                <span class="day-dish">${escapeHtml(d.dish || "")}</span>
              </span>
              <span class="mono day-time">${d.prep_minutes || "?"} min</span>
            </button>`;
        if (open) {
          html += `<div class="day-body">
            <hr class="divider" />
            ${d.imageUrl ? `<img class="day-img" src="${escapeHtml(d.imageUrl)}" alt="${escapeHtml(d.dish)}" loading="lazy" onerror="this.style.display='none'" />` : ""}
            <div class="day-tools no-print">
              <button class="star-btn ${isFav ? "star-active" : ""}" data-fav-dish="${escapeHtml(d.dish)}" title="Marcar como favorito">${isFav ? "★ Favorito" : "☆ Marcar favorito"}</button>
              <button class="btn-secondary small" data-regen-day="${escapeHtml(d.day)}" ${isRegenerating ? "disabled" : ""}>${isRegenerating ? "Buscando otro plato…" : "🔁 No me gustó, cambiar"}</button>
            </div>
            <div class="section-label">Ingredientes</div>
            <ul>${(d.ingredients || []).map((i) => `<li>${escapeHtml(formatIngredient(i))}</li>`).join("")}</ul>
            <div class="section-label">Paso a paso</div>
            <ol>${(d.steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
          </div>`;
        }
        html += `</div>`;
      });

      if (state.current.comodin) {
        const cIngredients = state.current.comodin.ingredients || [];
        const cSteps = state.current.comodin.steps || [];
        html += `<div class="comodin">
          ${state.current.comodin.imageUrl ? `<img class="day-img" src="${escapeHtml(state.current.comodin.imageUrl)}" alt="${escapeHtml(state.current.comodin.dish)}" loading="lazy" onerror="this.style.display='none'" />` : ""}
          <div class="comodin-label">Comodín para el día caótico</div>
          <div class="comodin-dish">${escapeHtml(state.current.comodin.dish)}</div>
          <div>${escapeHtml(state.current.comodin.note || "")}</div>
          ${cIngredients.length ? `
            <div class="section-label" style="margin-top:12px;">Ingredientes</div>
            <ul>${cIngredients.map((i) => `<li>${escapeHtml(formatIngredient(i))}</li>`).join("")}</ul>
          ` : ""}
          ${cSteps.length ? `
            <div class="section-label">Paso a paso</div>
            <ol>${cSteps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
          ` : ""}
        </div>`;
      }
      if (state.current.tip) html += `<div class="tip">💡 ${escapeHtml(state.current.tip)}</div>`;

      const shopping = buildShoppingList(state.current);
      if (Object.keys(shopping).length) {
        html += `<div class="card">
          <div class="card-title-row">
            <div class="card-title">Lista de compras</div>
            <button class="btn-secondary small no-print" id="whatsapp-btn">Enviar por WhatsApp</button>
          </div>`;
        Object.entries(shopping).forEach(([cat, items]) => {
          html += `<div class="cat-block"><div class="cat-label">${escapeHtml(cat)}</div>`;
          items.forEach((item) => {
            const key = cat + "::" + item.name.toLowerCase() + "|" + item.unit;
            const checked = !!state.checklist[key];
            const daysTag = item.days.size > 1 ? ` (${Array.from(item.days).join(" y ")})` : "";
            html += `<label class="check-row ${checked ? "checked" : ""}">
              <input type="checkbox" data-key="${escapeHtml(key)}" ${checked ? "checked" : ""} />
              <span>${escapeHtml(formatIngredient(item))}${escapeHtml(daysTag)}</span>
            </label>`;
          });
          html += `</div>`;
        });
        html += `</div>`;
      }
    }
  }

  if (state.showSettings) {
    html += `
      <div class="modal-backdrop no-print" id="modal-backdrop">
        <div class="modal">
          <div class="card-title">Configuración</div>

          <p class="hint"><strong>Opción gratis:</strong> generá el menú charlando con Claude.ai (usa tu suscripción, sin costo extra) y pegalo acá.</p>
          <button class="btn-secondary small" id="copy-prompt-btn">📋 Copiar mensaje para pegar en Claude.ai</button>
          ${state.copyFeedback ? `<div class="hint" style="margin-top:6px;">${escapeHtml(state.copyFeedback)}</div>` : ""}
          ${state.showManualPromptFallback ? `<textarea readonly rows="3" style="width:100%; margin-top:8px; font-size:12px;">${escapeHtml(state.showManualPromptFallback)}</textarea>` : ""}
          <p class="hint" style="margin-top:12px;">Después pegá acá la respuesta completa que te dé Claude (todo el JSON):</p>
          <textarea id="pasted-menu-input" rows="5" placeholder='{"days": [...], "comodin": {...}, "tip": "..."}'></textarea>
          <button class="btn-primary small" id="apply-pasted-btn">Cargar este menú</button>

          <hr class="divider" style="margin: 16px 0;" />

          <p class="hint"><strong>Opción automática y gratis:</strong> API key de Google Gemini (gratis, sin tarjeta). Con esto el menú se genera solo los domingos, sin que hagas nada.</p>
          <input type="password" id="gemini-key-input" placeholder="AIza..." value="${escapeHtml(state.geminiKey)}" />
          <div class="actions">
            <button class="btn-secondary small" id="save-gemini-key-btn">Guardar key de Gemini</button>
            <span class="key-status ${state.geminiKey ? "key-ok" : "key-missing"}">${state.geminiKey ? "✓ Cargada" : "Sin cargar"}</span>
          </div>

          <hr class="divider" style="margin: 16px 0;" />

          <p class="hint"><strong>Opción automática con Anthropic (tiene costo de API, centavos por semana):</strong> se usa solo si no cargaste una key de Gemini.</p>
          <input type="password" id="api-key-input" placeholder="sk-ant-..." value="${escapeHtml(state.apiKey)}" />
          <div class="actions">
            <button class="btn-secondary small" id="save-key-btn">Guardar key de Anthropic</button>
            <span class="key-status ${state.apiKey ? "key-ok" : "key-missing"}">${state.apiKey ? "✓ Cargada" : "Sin cargar"}</span>
          </div>

          <hr class="divider" style="margin: 16px 0;" />

          <p class="hint">Fotos de los platos: por defecto se genera una ilustración con IA para cada receta, sin cargar nada acá. Si preferís fotos reales en vez de ilustraciones, cargá una key gratis de Pexels (si falla, vuelve sola a la ilustración con IA).</p>
          <p class="hint">Fotos reales (opcional): key gratis de Pexels.</p>
          <input type="password" id="pexels-key-input" placeholder="Pexels API key" value="${escapeHtml(state.pexelsKey)}" />
          <div class="actions">
            <button class="btn-secondary small" id="save-pexels-key-btn">Guardar key de Pexels</button>
            <button class="btn-secondary small" id="test-pexels-btn">Probar</button>
            <span class="key-status ${state.pexelsKey ? "key-ok" : "key-missing"}">${state.pexelsKey ? "✓ Cargada" : "Sin cargar"}</span>
          </div>
          ${state.pexelsTestResult ? `<div class="hint" style="margin-top:6px;">${escapeHtml(state.pexelsTestResult)}</div>` : ""}

          <hr class="divider" style="margin: 16px 0;" />

          <p class="hint">Restricciones o preferencias (se aplican a todos los menús que se generen, en cualquier dispositivo).</p>
          <textarea id="restrictions-input" rows="3" placeholder="Ej: sin cerdo, poco picante, sin lactosa...">${escapeHtml(state.restrictions)}</textarea>
          <button class="btn-secondary small" id="save-restrictions-btn">Guardar preferencias</button>

          ${state.favorites.size ? `
          <hr class="divider" style="margin: 16px 0;" />
          <p class="hint">Favoritos (${state.favorites.size}). Marcalos/desmarcalos desde cada receta.</p>
          ` : ""}

          <div class="actions" style="margin-top: 16px;">
            <button class="btn-secondary" id="close-settings-btn">Cerrar</button>
          </div>
        </div>
      </div>`;
  }

  html += `</div>`;
  app.innerHTML = html;
  bindEvents();
}

function bindEvents() {
  const app = document.getElementById("app");
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };

  on("settings-btn", () => { state.showSettings = true; render(); });
  on("generate-btn", onGenerateClick);
  on("regen-btn", () => { state.confirmRegen = true; render(); });
  on("cancel-regen-btn", () => { state.confirmRegen = false; render(); });
  on("history-btn", () => { state.showHistory = !state.showHistory; render(); });
  on("whatsapp-btn", onShareWhatsapp);
  on("pdf-btn", onDownloadPdf);
  on("close-settings-btn", () => { state.showSettings = false; render(); });
  on("save-key-btn", () => onSaveApiKey(document.getElementById("api-key-input").value));
  on("save-gemini-key-btn", () => onSaveGeminiKey(document.getElementById("gemini-key-input").value));
  on("save-pexels-key-btn", () => onSavePexelsKey(document.getElementById("pexels-key-input").value));
  on("test-pexels-btn", onTestPexels);
  on("copy-prompt-btn", onCopyPromptForChat);
  on("apply-pasted-btn", onApplyPastedMenu);
  on("save-restrictions-btn", () => onSaveRestrictions(document.getElementById("restrictions-input").value));

  app.querySelectorAll(".day-head").forEach((btn) => {
    btn.onclick = () => {
      const day = btn.getAttribute("data-day");
      state.expandedDay = state.expandedDay === day ? null : day;
      render();
    };
  });
  app.querySelectorAll('input[type="checkbox"][data-key]').forEach((cb) => {
    cb.onchange = () => onToggleCheck(cb.getAttribute("data-key"));
  });
  app.querySelectorAll("[data-fav-dish]").forEach((btn) => {
    btn.onclick = (e) => { e.stopPropagation(); onToggleFavorite(btn.getAttribute("data-fav-dish")); };
  });
  app.querySelectorAll("[data-regen-day]").forEach((btn) => {
    btn.onclick = (e) => { e.stopPropagation(); regenerateDay(btn.getAttribute("data-regen-day")); };
  });
  app.querySelectorAll("[data-servings]").forEach((btn) => {
    btn.onclick = () => onSetServings(parseInt(btn.getAttribute("data-servings"), 10));
  });

  const backdrop = document.getElementById("modal-backdrop");
  if (backdrop) backdrop.addEventListener("click", (e) => { if (e.target === backdrop) { state.showSettings = false; render(); } });
}

init();
