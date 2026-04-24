#!/usr/bin/env node

const path = require('path');

// 优先使用 dist 构建产物，否则用 tsx 直接运行
const distPath = path.join(__dirname, '..', 'dist', 'index.js');
const srcPath = path.join(__dirname, '..', 'src', 'index.ts');

const fs = require('fs');
if (fs.existsSync(distPath)) {
  require(distPath);
} else {
  try {
    require('tsx/cjs');
    require(srcPath);
  } catch {
    console.error('Error: CLI 尚未构建，请先运行 pnpm build');
    process.exit(1);
  }
}
