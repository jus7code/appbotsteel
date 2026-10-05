#!/usr/bin/env bash
# Publica public/ en /var/www/botsim y recarga Nginx. Uso: ./deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
sudo mkdir -p /var/www/botsim
sudo rsync -a --delete public/ /var/www/botsim/
sudo chown -R root:root /var/www/botsim
sudo chmod -R a+rX /var/www/botsim
sudo install -m 644 deploy/nginx-botsim.conf /etc/nginx/sites-available/botsim
sudo ln -sf /etc/nginx/sites-available/botsim /etc/nginx/sites-enabled/botsim
sudo nginx -t
sudo systemctl reload nginx
echo "Desplegado en /var/www/botsim"
