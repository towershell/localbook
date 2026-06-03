#!/bin/bash
# 用 ImageMagick 生成 PWA 图标
# 用法: bash tools/gen-icon.sh
# 前提: apt install imagemagick 或 brew install imagemagick

set -e
cd "$(dirname "$0")/.."

if ! command -v convert &>/dev/null; then
  echo "请先安装 ImageMagick: sudo apt install imagemagick"
  exit 1
fi

echo "生成 icon-192.png ..."
convert -size 192x192 -define gradient:angle=135 \
  gradient:'#667eea-#764ba2' \
  -fill white -font system-ui -pointsize 72 \
  -gravity center -annotate +0-15 '📒' \
  -pointsize 22 -annotate +0+55 'LocalBook' \
  -matte -draw "roundRectangle 0,0 191,191 36,36" \
  icon-192.png 2>/dev/null || {
  # fallback: 纯色圆角图标
  convert -size 192x192 xc:'#4f46e5' \
    -fill white -font system-ui -pointsize 72 \
    -gravity center -annotate +0-15 '📒' \
    -pointsize 22 -annotate +0+55 'LocalBook' \
    icon-192.png
}

echo "生成 icon-512.png ..."
convert -size 512x512 -define gradient:angle=135 \
  gradient:'#667eea-#764ba2' \
  -fill white -font system-ui -pointsize 180 \
  -gravity center -annotate +0-40 '📒' \
  -pointsize 55 -annotate +0+130 'LocalBook' \
  icon-512.png 2>/dev/null || {
  convert -size 512x512 xc:'#4f46e5' \
    -fill white -font system-ui -pointsize 180 \
    -gravity center -annotate +0-40 '📒' \
    -pointsize 55 -annotate +0+130 'LocalBook' \
    icon-512.png
}

echo "完成: icon-192.png icon-512.png"
ls -lh icon-*.png
