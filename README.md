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
https://botsim.traumado.top → túnel Cloudflare → Nginx en 127.0.0.1:8080
