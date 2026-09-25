// Inline the app into one HTML file (dist/ranked.html) for hosts that take a
// single page, such as a claude.ai artifact.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const index = read('index.html');
const body = index.slice(index.indexOf('<header'), index.indexOf('<script')).trimEnd();
const scripts = ['src/ranking.js', 'src/categories.js', 'src/app.js']
  .map((p) => `<script>\n${read(p)}</script>`)
  .join('\n');

const out = `<title>Ranked</title>\n<style>\n${read('src/style.css')}</style>\n${body}\n${scripts}\n`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/ranked.html'), out);
console.log(`dist/ranked.html (${(out.length / 1024).toFixed(1)} KB)`);
