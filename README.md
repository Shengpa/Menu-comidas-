# Menú del domingo

PWA que arma el menú semanal (Lunes a Viernes), lista de compras y comodín — pensada para
funcionar igual que Tiburones Rugby Stats / El Kiosko de la 2012: Firebase + GitHub Pages,
sin backend propio.

## Cómo se comporta

- Si abrís la app un **domingo** y todavía no existe el menú de la semana que arranca al otro
  día, **se genera sola**.
- Si la abrís **cualquier otro día**, muestra el menú ya generado y no vuelve a llamar a la IA
  (no gasta de más). Si por algún motivo faltó generarlo (te salteaste un domingo, es la primera
  vez que la usás), aparece un botón para generarlo a mano.
- Siempre tenés un botón "Regenerar esta semana" por si querés forzar uno nuevo (pide
  confirmación antes de reemplazar).
- Cada semana generada queda guardada en Firestore, así la IA sabe qué platos ya usaste y no
  los repite en las próximas ~16 semanas.

## Funciones extra

- **Porciones**: chips 2/4/6 arriba de cada semana; reescala las cantidades de ingredientes
  (las recetas se generan siempre pensadas para 4).
- **"No me gustó, cambiar"**: botón dentro de cada receta que le pide a la IA un plato distinto
  solo para ese día, sin tocar el resto de la semana.
- **Favoritos (★)**: marcás un plato desde la receta. Los favoritos pueden volver a aparecer
  de vez en cuando (como mucho uno por semana) aunque ya se hayan usado.
- **Restricciones/preferencias**: campo de texto libre en ⚙️ (ej. "sin cerdo", "poco picante").
  Se guarda en Firestore, así aplica sin importar desde qué dispositivo generes el menú.
- **Enviar por WhatsApp**: botón junto a la lista de compras que abre WhatsApp con la lista
  ya armada, agrupada por rubro.
- **Descargar / imprimir PDF**: abre el diálogo de impresión del navegador con toda la semana
  expandida y sin los botones de la interfaz; desde ahí elegís "Guardar como PDF".
- **Generar sin gastar** (⚙️): copia un mensaje listo para pegar en una conversación de
  Claude.ai (usa tu suscripción, no la API) — pegás la respuesta de vuelta en la app y se
  guarda igual que si la hubiera generado la API.
- **Generar automático y gratis con Google Gemini**: cargando una API key gratuita de Google
  (sin tarjeta, en aistudio.google.com/apikey) el menú se genera solo los domingos sin gastar
  nada. Si además cargás una key de Anthropic, Gemini tiene prioridad por ser gratis; Anthropic
  queda como respaldo de pago.
- **Fotos de los platos**: cargando una API key gratuita de Pexels (pexels.com/api, sin costo)
  cada receta se muestra con una foto real del plato.

## Sobre compartir la app con otra persona

Tal como está armada, la app usa **una sola base de datos** (tu proyecto Firebase). Si le pasás
la URL a otra persona, va a ver y editar el mismo menú, la misma lista de compras y los mismos
favoritos que vos — no tiene su propio espacio separado. Para que alguien tenga su menú
totalmente aparte, tiene que repetir estos mismos pasos con su propio proyecto Firebase.

## 1. Crear el proyecto Firebase

1. Andá a https://console.firebase.google.com y creá un proyecto nuevo.
2. Dentro del proyecto: **Compilación > Firestore Database > Crear base de datos** (modo
   producción, la región que prefieras).
3. En **Configuración del proyecto > Tus apps**, agregá una app web (ícono `</>`), le ponés
   un nombre y copiás el objeto `firebaseConfig` que te muestra.
4. Pegá esos valores en `firebase-config.js`, reemplazando los placeholders.
5. En **Firestore > Reglas**, pegá el contenido de `firestore.rules` (incluido en esta carpeta)
   y publicá. Nota: son reglas abiertas (cualquiera con la URL puede leer/escribir), igual que
   conviene mantener esta app en una URL no publicitada, para uso personal.

## 2. Subir a GitHub Pages

1. Creá un repo nuevo (o una carpeta dentro de uno existente) y subí estos archivos y carpetas:
   `index.html`, `style.css`, `app.js`, `firebase-config.js`, `manifest.json`, `sw.js`, y la
   carpeta `icons/` completa (con los 3 PNG adentro).
2. En **Settings > Pages** del repo, elegí la rama y carpeta donde están estos archivos.
3. Esperá el deploy y entrá a la URL que te da GitHub Pages.

## 3. Cargar tu API key de Anthropic

La generación del menú llama directamente a la API de Anthropic desde el navegador (sin
servidor intermedio), así que necesita tu propia API key:

1. Conseguila en https://console.anthropic.com (Settings > API Keys).
2. Abrí la app, tocá el ícono ⚙️ y pegala ahí.
3. Se guarda solo en el `localStorage` de ese navegador/dispositivo — no se sube a Firestore
   ni a ningún otro lado. Si la abrís desde otro dispositivo, vas a tener que cargarla de nuevo
   ahí también.

**Importante:** como la key vive en el navegador, cualquiera que abra esa URL y mire las
herramientas de desarrollador podría verla. No compartas el link de esta app públicamente, y si
alguna vez sospechás que la key quedó expuesta, revocala desde la consola de Anthropic y generá
una nueva.

## Archivos

- `index.html` — shell de la app
- `style.css` — estilos
- `app.js` — toda la lógica (fecha, prompt, llamada a la API, Firestore, render)
- `firebase-config.js` — tus credenciales del proyecto Firebase (completar)
- `manifest.json` / `sw.js` — para que sea instalable como PWA
- `firestore.rules` — reglas de Firestore para copiar en la consola
