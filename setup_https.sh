#!/bin/bash
# HTTPS 配置脚本
# 用法:
#   测试环境: bash setup_https.sh selfsigned
#   生产环境: bash setup_https.sh letsencrypt your-domain.com

set -e

MODE=${1:-help}
DOMAIN=${2:-}

NGINX_CONF="/home/ai/文档/ai616/nginx-fixed.conf"

case "$MODE" in
  selfsigned)
    echo "=== 自签名证书（仅测试用）==="
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout /tmp/selfsigned.key \
      -out /tmp/selfsigned.crt \
      -subj "/CN=localhost"
    echo "证书已生成: /tmp/selfsigned.crt, /tmp/selfsigned.key"
    echo "在 nginx-fixed.conf 中取消注释 HTTPS server block，"
    echo "将 ssl_certificate 指向 /tmp/selfsigned.crt"
    echo "将 ssl_certificate_key 指向 /tmp/selfsigned.key"
    ;;

  letsencrypt)
    if [ -z "$DOMAIN" ]; then
      echo "用法: bash setup_https.sh letsencrypt your-domain.com"
      exit 1
    fi
    echo "=== Let's Encrypt 证书 ==="
    sudo apt-get update -qq && sudo apt-get install -y -qq certbot python3-certbot-nginx
    sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@${DOMAIN}"
    echo "证书已安装。在 nginx-fixed.conf 中取消注释 HTTPS server block。"
    echo "sudo nginx -s reload  # 重载生效"
    ;;

  help|*)
    echo "HTTPS 配置:"
    echo "  bash setup_https.sh selfsigned              # 自签名测试"
    echo "  bash setup_https.sh letsencrypt <域名>       # 生产 Let's Encrypt"
    echo ""
    echo "nginx-fixed.conf 中已有注释版 HTTPS 配置模板，获取证书后取消注释即可。"
    ;;
esac
