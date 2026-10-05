# BotSim

Aplicación web que detecta los movimientos del cuerpo con la webcam y hace que un modelo 3D
humanoide los imite en tiempo real.

**Demo:** https://botsim.traumado.top (Chrome o Edge de escritorio)

Todo el procesamiento ocurre **en el navegador del usuario**: la detección de pose (MediaPipe) y el
render 3D (Three.js). El servidor solo entrega archivos estáticos; ninguna imagen de la cámara sale
del equipo del usuario.

---

## Índice
1. [Uso](#uso)
2. [Arquitectura](#arquitectura)
3. [Cómo funciona](#cómo-funciona)
   - [Detección de pose](#1-detección-de-pose)
   - [Cambio de sistema de coordenadas y modo espejo](#2-cambio-de-sistema-de-coordenadas-y-modo-espejo)
   - [Suavizado](#3-suavizado-filtro-one-euro)
   - [Retargeting: de landmarks a rotaciones de huesos](#4-retargeting-de-landmarks-a-rotaciones-de-huesos)
   - [Pérdida de visibilidad](#5-pérdida-de-visibilidad)
4. [Modelos 3D](#modelos-3d)
5. [Estructura del proyecto](#estructura-del-proyecto)
6. [Desarrollo local](#desarrollo-local)
7. [Despliegue](#despliegue)
8. [Limitaciones conocidas](#limitaciones-conocidas)
9. [Tecnologías](#tecnologías)

---

## Uso

1. Abrir la página y esperar a que cargue el modelo.
2. Elegir un modelo en el desplegable (Spartan, Robot M.A.N.U.L. o Mech Drone).
3. Pulsar **Iniciar cámara** y aceptar el permiso del navegador.
4. Colocarse a 2–3 m de la cámara, con buena luz y el cuerpo entero a la vista.

| Control | Función |
|---|---|
| Desplegable de modelo | Cambia de modelo sin recargar ni apagar la cámara. También `?model=robot` en la URL. |
| Iniciar / Detener cámara | Enciende o apaga la webcam. Al detenerla el modelo vuelve a su pose de reposo. |
| Modo espejo | Activado: el modelo se comporta como tu reflejo. Desactivado: mueve el mismo lado que tú. |
| Indicador | Gris: cámara apagada · Rojo: sin persona · Verde: persona detectada. |
| Ratón sobre la escena | Arrastrar: rotar · Rueda: zoom · Botón derecho: desplazar. |
| ⚙ Ajustes | Activar o desactivar partes del cuerpo, estabilidad del filtro y dibujo del esqueleto. |

En la esquina inferior derecha se ve la cámara con el esqueleto detectado dibujado encima y los FPS.

---

## Arquitectura

```
┌─────────────────────────── Navegador del usuario ───────────────────────────┐
│                                                                             │
│  Webcam ──► MediaPipe Pose Landmarker ──► 33 landmarks 3D ──► Filtro        │
│             (WebAssembly + GPU)                               One Euro      │
│                    │                                              │         │
│                    ▼                                              ▼         │
│        Vista pequeña: vídeo + esqueleto              Retargeting (mapping)  │
│                                                               │             │
│                                                               ▼             │
│                                        Three.js: rota los huesos del GLB    │
└─────────────────────────────────────────────────────────────────────────────┘
                 ▲  HTML, JS, CSS y modelos .glb (solo archivos estáticos)
                 │
     HTTPS ── Cloudflare (botsim.traumado.top) ── túnel cloudflared ──┐
                                                                      ▼
                                             VM Azure: Nginx 127.0.0.1:8080
```

- **HTTPS es obligatorio**: los navegadores solo permiten usar la cámara en un contexto seguro.
  Lo proporciona Cloudflare; dentro de la VM Nginx escucha en HTTP solo en localhost.
- **No se abre ningún puerto en Azure**: todo el tráfico entra por el túnel de Cloudflare.
- **Sin empaquetador**: las librerías se cargan desde CDN con un `importmap`, así que el sitio se
  despliega copiando una carpeta.

---

## Cómo funciona

### 1. Detección de pose
[`public/js/pose.js`](public/js/pose.js)

Se usa **MediaPipe Pose Landmarker** (modelo *full*) en modo `VIDEO`. Por cada fotograma de la
cámara devuelve 33 puntos del cuerpo (landmarks) en dos versiones:

- `landmarks`: coordenadas normalizadas sobre la imagen (0–1) y una **visibilidad** por punto.
  Se usan para dibujar el esqueleto sobre el vídeo y para saber qué puntos son fiables.
- `worldLandmarks`: coordenadas **3D en metros**, con origen en el centro de la cadera.
  Son las que mueven el modelo, porque no dependen de la distancia a la cámara.

Se intenta usar la GPU y, si no está disponible, la CPU. El bucle va sincronizado con los
fotogramas del vídeo (`requestVideoFrameCallback`).

### 2. Cambio de sistema de coordenadas y modo espejo
[`public/js/mapping.js`](public/js/mapping.js) → `ingest()`

MediaPipe usa *y* hacia abajo y *z* negativa hacia la cámara. Three.js usa *y* hacia arriba, y el
modelo mira hacia +Z (hacia el espectador). La conversión es `(x, y, z) → (x, −y, −z)`.

Como el modelo está de frente, su lado derecho queda a la izquierda de la pantalla:

- **Modo espejo**: el brazo izquierdo del usuario debe mover el brazo **derecho** del modelo
  (como un reflejo). Se intercambian los índices izquierda/derecha y se invierte X.
- **Sin espejo**: cada lado mueve su mismo lado.

### 3. Suavizado: filtro One Euro
Los landmarks tiemblan unos milímetros entre fotogramas. Un suavizado fijo (media móvil) reduce
el temblor pero añade retraso. El **filtro One Euro** adapta la intensidad a la velocidad:

- punto casi quieto → frecuencia de corte baja → mucho suavizado, sin temblor;
- punto moviéndose rápido → frecuencia de corte alta → poco suavizado, sin retraso.

Se aplica a cada coordenada de cada landmark y solo cuando llega un fotograma nuevo de la cámara
(así no depende de los FPS del monitor). El control **Estabilidad** del panel ajusta la frecuencia
de corte mínima (de 3 Hz a 0,3 Hz). Encima se aplica una interpolación ligera (`slerp`) a las
rotaciones finales.

### 4. Retargeting: de landmarks a rotaciones de huesos
[`public/js/mapping.js`](public/js/mapping.js) → `RULES`, `solve()`, `update()`

Los landmarks son **posiciones**; un esqueleto se anima con **rotaciones**. Además, cada modelo
parte de una pose distinta (pose A, codos doblados, etc.), así que no se pueden copiar ángulos
directamente. El método es:

**a) Pose de reposo.** Al cargar el modelo se guarda la rotación de reposo de cada hueso. Para cada
regla se calcula, en reposo, hacia dónde apunta el hueso (por ejemplo, del hombro al codo) y se
guarda en el espacio local del hueso. Así se compensa automáticamente la pose A inicial.

**b) En cada fotograma, para cada hueso (de padres a hijos):**
1. Se restablece la rotación de reposo.
2. Se calcula la dirección actual del hueso en el mundo (dirección de reposo × rotación de los padres).
3. Se calcula la dirección deseada a partir de dos landmarks (por ejemplo, codo − hombro).
4. Se obtiene el cuaternión `q_delta` que lleva una dirección a la otra.
5. Se pasa a espacio local: `q_local' = q_padre⁻¹ · q_delta · q_padre · q_local`.

Como se procesa de padres a hijos, el antebrazo se calcula ya con el brazo colocado.

**c) Dirección + giro.** Una dirección no basta: un brazo que apunta a un sitio aún puede girar sobre
su eje. Por eso algunas reglas usan un **eje secundario** y se construye una base ortonormal
completa (dos vectores) en reposo y en la pose deseada:

| Parte | Hueso | Eje principal | Eje secundario (giro) |
|---|---|---|---|
| Cadera | `Hips` | centro de caderas → centro de hombros | cadera derecha → izquierda |
| Columna | `Spine` | ídem | hombro derecho → izquierdo (peso 0,6) |
| Cabeza | `Head` | oreja derecha → izquierda | orejas → nariz (peso 0,8) |
| Brazo | `Arm` | hombro → codo | **plano de flexión del codo** |
| Antebrazo | `ForeArm` | codo → muñeca | — |
| Muslo | `UpLeg` | cadera → rodilla | **plano de flexión de la rodilla** |
| Pierna | `Leg` | rodilla → tobillo | — |
| Pie | `Foot` | tobillo → punta del pie | — |
| Mano (experimental) | `Hand` | muñeca → nudillos | índice → meñique |

El **plano de flexión** es la normal `brazo × antebrazo`. Con el codo doblado indica con precisión
cómo está girado el brazo, y así el codo se dobla como una bisagra (hacia delante; la rodilla,
hacia atrás). Con el brazo casi recto esa normal no es fiable, así que se mezcla de forma gradual
entre unos 15° y 37° de flexión. Si el modelo ya tiene la articulación doblada en reposo (robot), el
plano de reposo se toma de su propia geometría.

Los **pesos** (< 1) aplican solo una parte de la rotación, para que columna y cabeza no se exageren.

### 5. Pérdida de visibilidad
Cada regla exige que sus landmarks tengan visibilidad ≥ 0,3. Si no la tienen (brazo tapado, fuera
del encuadre), el hueso **mantiene su última pose 0,8 s** y después vuelve suavemente a la de
reposo. Si no hay ninguna persona, todo el modelo vuelve a la pose de reposo.

---

## Modelos 3D

Definidos en [`public/js/models.js`](public/js/models.js). Las reglas usan nombres canónicos estilo
Mixamo (`LeftArm`, `LeftForeArm`…); cada modelo puede traducirlos a los nombres de su rig con
`bones`. Si un hueso no existe, su regla se omite automáticamente.

| Modelo | Rig | Partes animadas | Reglas |
|---|---|---|---|
| Spartan | Mixamo, pose A | Torso, cabeza, brazos, piernas, pies (y muñecas opcional) | 15/15 |
| Robot M.A.N.U.L. | Propio, codos doblados | Torso (un solo bloque), cabeza, brazos, piernas | 10/15 |
| Mech Drone | Propio, sin piernas | Brazos y antebrazos | 4/15 |

**Añadir un modelo:**
1. Comprimir el GLB: `.venv-tools/bin/python tools/compress_glb.py original.glb public/models/nuevo.glb`
   (guardar el original en `assets/`).
2. Abrir la página y mirar en la consola (F12) la tabla *"Huesos de …"*.
3. Añadir una entrada en `MODELS` con `url: 'models/nuevo.glb?v=dev'` y, si no es Mixamo, el
   diccionario `bones`. Los lados se asignan por **posición**: la izquierda del modelo es +X.
4. `./deploy/deploy.sh`

`compress_glb.py` reduce las texturas a 1024 px (JPEG si no tienen transparencia) y convierte los
materiales `KHR_materials_pbrSpecularGlossiness`, que Three.js ya no soporta, a metallic-roughness.
Resultado: Spartan 130 → 9 MB, robot 16 → 2,9 MB, dron 15 → 3,7 MB.

---

## Estructura del proyecto

```
proyectobot/
├── public/                  Sitio estático (lo que se publica)
│   ├── index.html           Interfaz e importmap de librerías
│   ├── css/style.css
│   ├── js/
│   │   ├── main.js          Interfaz, carga de modelos, enlace entre detección y render
│   │   ├── viewer.js        Escena Three.js: luces, cámara, órbita, carga de GLB y huesos
│   │   ├── pose.js          Cámara y MediaPipe Pose Landmarker
│   │   ├── mapping.js       Retargeting: filtro, reglas y cálculo de rotaciones
│   │   └── models.js        Lista de modelos y correspondencia de huesos
│   └── models/*.glb         Modelos comprimidos (no versionados en git)
├── assets/*.glb             Modelos originales (no versionados)
├── deploy/
│   ├── nginx-botsim.conf    Sitio de Nginx
│   └── deploy.sh            Publica public/ en /var/www/botsim
└── tools/
    ├── compress_glb.py      Compresión de texturas y conversión de materiales
    └── devserver.py         Servidor local sin caché
```

---

## Desarrollo local

```bash
python3 tools/devserver.py 8080 public
```
y abrir http://localhost:8080. `localhost` cuenta como contexto seguro, así que la cámara funciona
sin HTTPS. Para la herramienta de compresión:
```bash
python3 -m venv .venv-tools && .venv-tools/bin/pip install pillow
```

---

## Despliegue

Máquina virtual Ubuntu 24.04 en Azure, publicada mediante un túnel de Cloudflare.

| Pieza | Configuración |
|---|---|
| Cloudflare Zero Trust → Tunnels → Public Hostname | `botsim.traumado.top` → `http://localhost:8080` |
| cloudflared | Servicio systemd (`cloudflared.service`), túnel gestionado desde el dashboard |
| Nginx | `deploy/nginx-botsim.conf`, escucha solo en `127.0.0.1:8080`, servicio systemd habilitado |
| Archivos | `/var/www/botsim` (copia de `public/`) |

**Publicar cambios:**
```bash
./deploy/deploy.sh
```
Copia `public/` a `/var/www/botsim`, instala la configuración de Nginx, la valida y la recarga.

**Caché.** Cloudflare guarda los archivos estáticos. Para que un cambio se vea siempre, las URLs de
scripts, estilos y modelos llevan `?v=dev` en el código, y `deploy.sh` lo sustituye por el hash del
commit actual. Todo `import` o `url` nuevo debe llevar también `?v=dev`. Nginx envía `no-cache`
para HTML/JS/CSS y un día de caché para los `.glb`.

**Comprobaciones:** `systemctl status nginx cloudflared` · logs en `/var/log/nginx/botsim.*.log`.

---

## Limitaciones conocidas

- **Profundidad**: con una sola cámara, MediaPipe estima mal el eje Z. Los brazos estirados hacia
  la cámara pueden verse menos extendidos de lo real.
- **Giro del antebrazo**: no se calcula la rotación del antebrazo sobre su eje (pronación).
- **Muñecas**: MediaPipe Pose solo da 3 puntos por mano, así que son inestables. Están desactivadas
  por defecto (⚙ → Muñecas).
- **Dedos**: no se animan. Requeriría MediaPipe Hand Landmarker además del de pose.
- **Desplazamiento**: el modelo rota en su sitio; no se traslada si el usuario camina o salta.
- **Rendimiento**: necesita WebGL2 y un equipo con GPU razonable para unos 30 FPS.

---

## Tecnologías

| Librería | Versión | Uso |
|---|---|---|
| [Three.js](https://threejs.org) | 0.169.0 | Render 3D, carga de GLB, controles de órbita |
| [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js) | 0.10.18 | Detección de pose en el navegador |
| Nginx | 1.24 | Servidor estático |
| Cloudflare Tunnel | — | HTTPS y publicación sin abrir puertos |

Referencia del filtro: Casiez, Roussel y Vogel, *1€ Filter: A Simple Speed-based Low-pass Filter
for Noisy Input in Interactive Systems*, CHI 2012.
