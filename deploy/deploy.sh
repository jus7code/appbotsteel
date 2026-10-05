#!/usr/bin/env bash
# Publica public/ en /var/www/botsim y recarga Nginx. Uso: ./deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
sudo mkdir -p /var/www/botsim
sudo rsync -a --delete public/ /var/www/botsim/
# Versiona las URLs de scripts y estilos con el commit actual para invalidar la caché de Cloudflare
VERSION="$(git rev-parse --short HEAD)$(git diff --quiet HEAD -- public || echo "-$(date +%s)")"
sudo sed -i "s/?v=dev/?v=${VERSION}/g" /var/www/botsim/index.html /var/www/botsim/js/*.js
sudo chown -R root:root /var/www/botsim
sudo chmod -R a+rX /var/www/botsim
sudo install -m 644 deploy/nginx-botsim.conf /etc/nginx/sites-available/botsim
sudo ln -sf /etc/nginx/sites-available/botsim /etc/nginx/sites-enabled/botsim
sudo nginx -t
sudo systemctl reload nginx
echo "Desplegado en /var/www/botsim (versión ${VERSION})"
