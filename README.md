# BotSim

Un modelo 3D imita los movimientos captados por la webcam. Todo se procesa en el navegador
(MediaPipe Tasks Vision + Three.js). La VM solo sirve archivos estáticos.

## Estructura
```
public/            sitio estático (lo que sirve Nginx)
  index.html
  css/style.css
  js/main.js
  models/modelo.glb   (no versionado, ~95 MB)
deploy/            configuración de Nginx / cloudflared
```

## Dependencias (por CDN, sin build)
- three@0.169.0 (jsDelivr)
- @mediapipe/tasks-vision@0.10.18 (jsDelivr) + modelo pose_landmarker (Google Storage)

## Probar en local
```
cd public && python3 -m http.server 8080
```
`localhost` cuenta como contexto seguro, así que la cámara funciona sin HTTPS.

## Producción
```
navegador ──HTTPS──> Cloudflare (botsim.traumado.top) ──túnel──> cloudflared (VM)
                                                                    └─> Nginx 127.0.0.1:8080 -> /var/www/botsim
```
- **Cloudflare Zero Trust → Tunnels → Public Hostname:** `botsim.traumado.top` → `http://localhost:8080`.
- **Nginx** (`deploy/nginx-botsim.conf`) solo escucha en localhost; no se abre ningún puerto en Azure.
  Es un servicio systemd habilitado: arranca solo al reiniciar la VM (`systemctl status nginx`).
- **Desplegar cambios:** `./deploy/deploy.sh` (copia `public/` a `/var/www/botsim` y recarga Nginx).
- **Caché:** las URLs de scripts y estilos llevan `?v=dev` en el código; `deploy.sh` lo cambia por el
  hash del commit, así Cloudflare nunca sirve una versión vieja. Los imports nuevos en `main.js`
  deben llevar también `?v=dev`.
- Logs: `/var/log/nginx/botsim.access.log` y `botsim.error.log`.

## Herramientas
- `tools/compress_glb.py`: reduce las texturas del GLB (original en `assets/`, no versionado).
  `python3 -m venv .venv-tools && .venv-tools/bin/pip install pillow`
- `tools/devserver.py`: servidor local sin caché para desarrollo.
