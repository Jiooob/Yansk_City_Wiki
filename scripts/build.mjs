import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import MarkdownIt from 'markdown-it';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestName = '.wiki-generated.json';
const markdownExtension = /\.md$/i;
const naturalOrder = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'variant' });
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const caseKey = value => value.normalize('NFC').toLowerCase();
const urlPath = value => value.split('/').map(encodeURIComponent).join('/');
const slug = value => value.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'section';
const inside = (parent, child) => { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
const overlap = (a, b) => inside(a, b) || inside(b, a);
const relativeURL = (from, to) => urlPath(path.posix.relative(path.posix.dirname(from), to));
const fail = (source, message) => { throw new Error(`${source}: ${message}`); };

async function stat(file) {
  try { return await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function physicalPath(file) {
  const suffix = [];
  let ancestor = file;
  while (!(await stat(ancestor))) {
    suffix.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  return path.join(await fs.realpath(ancestor), ...suffix);
}

function safeRelative(value, owner) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value)) fail(owner, `不安全的相对路径 ${JSON.stringify(value)}`);
  const normalized = path.posix.normalize(value);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) fail(owner, `路径越过源目录：${value}`);
  return normalized;
}

function uniqueID(base, used) {
  let id = base, suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  used.add(id);
  return id;
}

async function readConfig(configFile, required) {
  const info = await stat(configFile);
  if (!info) { if (required) fail(configFile, '配置文件不存在'); return {}; }
  if (!info.isFile()) fail(configFile, '配置必须是普通文件');
  let config;
  try { config = JSON.parse(await fs.readFile(configFile, 'utf8')); } catch (error) { fail(configFile, `配置不是有效 JSON：${error.message}`); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail(configFile, '配置必须是对象');
  for (const key of ['title', 'version']) if (config[key] !== undefined && typeof config[key] !== 'string') fail(configFile, `${key} 必须是字符串`);
  if (config.home !== undefined && config.home !== null && (typeof config.home !== 'string' || !config.home)) fail(configFile, 'home 必须是源文件相对路径或 null');
  if (config.navigation !== undefined && !Array.isArray(config.navigation)) fail(configFile, 'navigation 必须是数组');
  return config;
}

async function collectSources(sourceRoot) {
  const rootInfo = await stat(sourceRoot);
  if (!rootInfo || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail(sourceRoot, '源目录不存在或不是普通目录');
  const files = new Map(), names = new Map();
  async function visit(directory, prefix = '') {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => naturalOrder.compare(a.name, b.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      safeRelative(relative, path.join(directory, entry.name));
      const key = caseKey(relative);
      if (names.has(key)) fail(sourceRoot, `源路径大小写或 Unicode 碰撞：${names.get(key)} / ${relative}`);
      names.set(key, relative);
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(absolute, '源目录内不允许符号链接');
      if (entry.isDirectory()) await visit(absolute, relative);
      else if (entry.isFile()) files.set(relative, await fs.readFile(absolute));
      else fail(absolute, '源附件必须是普通文件');
    }
  }
  await visit(sourceRoot);
  return files;
}

function inlineText(token) {
  if (!token) return '';
  if (token.children) return token.children.map(inlineText).join('');
  if (token.type === 'softbreak' || token.type === 'hardbreak') return ' ';
  return ['text', 'code_inline', 'image'].includes(token.type) ? token.content : '';
}

function parseDocument(md, source, bytes, absolute) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail(absolute, 'Markdown 不是有效 UTF-8'); }
  const tokens = md.parse(text, {}), headings = [], used = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'heading_open') continue;
    const title = inlineText(tokens[i + 1]).trim();
    const id = uniqueID(slug(title), used);
    token.attrSet('id', id);
    headings.push({ level: Number(token.tag.slice(1)), title, id });
  }
  return { source, tokens, headings, title: headings[0]?.title || path.posix.basename(source).replace(markdownExtension, '') };
}

function resolveSourceURL(raw, source, sources, sourceRoot) {
  if (!raw || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw) || raw.startsWith('#') || raw.startsWith('?')) return null;
  const separator = raw.search(/[?#]/);
  const pathname = separator < 0 ? raw : raw.slice(0, separator);
  const suffix = separator < 0 ? '' : raw.slice(separator);
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { fail(path.join(sourceRoot, source), `链接包含无效 URL 编码：${raw}`); }
  if (!decoded || decoded.includes('\\') || decoded.includes('\0')) fail(path.join(sourceRoot, source), `不安全的链接：${raw}`);
  const target = path.posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : path.posix.join(path.posix.dirname(source), decoded));
  safeRelative(target, path.join(sourceRoot, source));
  if (!sources.has(target)) fail(path.join(sourceRoot, source), `链接目标不存在或不是文件：${raw}`);
  return { target, suffix };
}

function rewriteLinks(doc, sources, documents, sourceRoot) {
  const walk = tokens => {
    for (const token of tokens) {
      const attribute = token.type === 'image' ? 'src' : token.type === 'link_open' ? 'href' : null;
      if (attribute) {
        const raw = token.attrGet(attribute);
        const resolved = resolveSourceURL(raw, doc.source, sources, sourceRoot);
        if (resolved) {
          const output = token.type !== 'image' && markdownExtension.test(resolved.target)
            ? documents.get(resolved.target).output : `assets/source/${resolved.target}`;
          token.attrSet(attribute, relativeURL(doc.output, output) + resolved.suffix);
        }
      }
      if (token.children) walk(token.children);
    }
  };
  walk(doc.tokens);
}

function navigationFor(config, documents, configFile) {
  const ordered = [], usedSources = new Set(), usedIDs = new Set();
  for (const entry of config.navigation || []) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(configFile, '每个 navigation 项必须是对象');
    const source = safeRelative(entry.source, configFile);
    if (!documents.has(source)) fail(configFile, `导航源文件不存在：${source}`);
    if (usedSources.has(source)) fail(configFile, `导航重复引用：${source}`);
    if (entry.label !== undefined && (typeof entry.label !== 'string' || !entry.label.trim())) fail(configFile, `导航 ${source} 的 label 必须是非空字符串`);
    if (entry.id !== undefined && (typeof entry.id !== 'string' || !entry.id.trim())) fail(configFile, `导航 ${source} 的 id 必须是非空字符串`);
    if (entry.id && usedIDs.has(entry.id)) fail(configFile, `导航 id 重复：${entry.id}`);
    usedSources.add(source);
    if (entry.id) usedIDs.add(entry.id);
    ordered.push({ ...documents.get(source), label: entry.label, id: entry.id });
  }
  for (const source of [...documents.keys()].sort(naturalOrder.compare)) {
    if (!usedSources.has(source)) ordered.push({ ...documents.get(source) });
  }
  for (const entry of ordered) {
    if (!entry.id) entry.id = uniqueID(slug(entry.source.replace(markdownExtension, '')), usedIDs);
    entry.label ||= entry.title;
  }
  return ordered;
}

function renderPage(page, navigation, config, md) {
  const title = config.title || '设定 Wiki', version = config.version || '';
  const resource = target => escapeHTML(relativeURL(page.output, target));
  const entries = navigation.map(entry => `<li><a href="${resource(entry.output)}" data-chapter="${escapeHTML(entry.id)}"${entry.output === page.output ? ' class="active" aria-current="page"' : ''}>${escapeHTML(entry.label)}</a></li>`).join('\n');
  const download = page.source ? `<a class="source-download" href="${resource(`assets/source/${page.source}`)}" download>下载本页 Markdown 源文件</a>` : '';
  const minimum = page.headings?.length ? Math.min(...page.headings.map(heading => heading.level)) : 0;
  const children = (page.headings || []).filter(heading => heading.level === minimum + 1);
  const outline = children.length ? `<details class="page-outline"><summary>本页目录</summary><ol>${children.map(heading => `<li><a href="#${escapeHTML(encodeURIComponent(heading.id))}">${escapeHTML(heading.title)}</a></li>`).join('')}</ol></details>` : '';
  const current = navigation.findIndex(entry => entry.output === page.output);
  const neighbors = [[navigation[current - 1], 'previous-chapter', '上一章'], [navigation[current + 1], 'next-chapter', '下一章']];
  const pager = current >= 0 ? `<nav class="chapter-pager" aria-label="章节翻页">${neighbors.filter(([entry]) => entry).map(([entry, className, label]) => `<a class="${className}" href="${resource(entry.output)}"><small>${label}</small><span>${escapeHTML(entry.title)}</span></a>`).join('')}</nav>` : '';
  const article = page.tokens ? md.renderer.render(page.tokens, md.options, {}) : `<h1>${escapeHTML(title)}</h1><ul>${navigation.filter(entry => entry.source).map(entry => `<li><a href="${resource(entry.output)}">${escapeHTML(entry.label)}</a></li>`).join('')}</ul>`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHTML(page.title)} · ${escapeHTML(title)}</title><link rel="stylesheet" href="${resource('css/style.css')}"><script defer src="${resource('js/main.js')}"></script></head>
<body><button id="sidebar-toggle" type="button" aria-controls="sidebar" aria-expanded="false" aria-label="展开章节目录">☰</button>
<nav id="sidebar" aria-label="章节目录"><div class="site-name">${escapeHTML(title)}</div><div class="site-version">${escapeHTML(version)}</div><ol id="chapter-nav">${entries}</ol>${download}</nav>
<main id="content">${outline}<article id="worldbuilding">${article}</article>${pager}</main></body></html>\n`;
}

function allowedGenerated(file) {
  return file === 'index.html' || (file.startsWith('pages/') && /\.html$/.test(file)) || file.startsWith('assets/source/');
}

async function readManifest(root) {
  const filename = path.join(root, manifestName), info = await stat(filename);
  if (!info) return { files: [], sha256: {}, bytes: null };
  if (!info.isFile() || info.isSymbolicLink()) fail(filename, '构建清单必须是普通文件');
  const bytes = await fs.readFile(filename);
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); } catch { fail(filename, '构建清单不是有效 JSON'); }
  if (!manifest || typeof manifest !== 'object' || manifest.version !== 1 || !Array.isArray(manifest.files)) fail(filename, '不支持的构建清单格式');
  const seen = new Set();
  for (const file of manifest.files) {
    if (safeRelative(file, filename) !== file || !allowedGenerated(file)) fail(filename, `清单包含非法输出路径：${file}`);
    if (seen.has(caseKey(file))) fail(filename, `清单包含重复或大小写碰撞路径：${file}`);
    seen.add(caseKey(file));
  }
  const hashes = manifest.sha256 || {};
  if (!hashes || typeof hashes !== 'object' || Array.isArray(hashes)) fail(filename, 'sha256 必须是对象');
  for (const [file, hash] of Object.entries(hashes)) {
    if (!manifest.files.includes(file) || !/^[a-f\d]{64}$/.test(hash)) fail(filename, `无效的内容指纹：${file}`);
  }
  return { files: manifest.files, sha256: hashes, bytes };
}

async function inspectOutput(root, relative) {
  const segments = relative.split('/');
  let current = root;
  for (let i = 0; i < segments.length; i++) {
    current = path.join(current, segments[i]);
    const info = await stat(current);
    if (!info) return null;
    if (info.isSymbolicLink()) fail(current, '输出路径不允许符号链接');
    if (i < segments.length - 1 && !info.isDirectory()) fail(current, '输出的父路径不是目录');
    if (i === segments.length - 1) {
      if (!info.isFile()) fail(current, '输出位置已被目录或特殊文件占用');
      return fs.readFile(current);
    }
  }
}

async function validatePlan(root, plan, previous) {
  const names = new Map(), backups = new Map(), tracked = new Set(previous.files);
  for (const relative of new Set([...plan.keys(), ...previous.files])) {
    safeRelative(relative, root);
    const key = caseKey(relative);
    if (names.has(key) && names.get(key) !== relative) fail(root, `输出大小写路径碰撞：${names.get(key)} / ${relative}`);
    names.set(key, relative);
    const bytes = await inspectOutput(root, relative);
    backups.set(relative, bytes);
    if (!bytes) continue;
    if (!tracked.has(relative)) fail(path.join(root, relative), '已有手工文件，拒绝覆盖；请移走文件或选择空的输出目录');
    const expected = previous.sha256[relative];
    if (!expected || digest(bytes) !== expected) fail(path.join(root, relative), '旧生成物已修改或缺少内容指纹，拒绝覆盖或删除');
  }
  backups.set(manifestName, previous.bytes);
  return backups;
}

async function atomicWrite(filename, bytes) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.wiki-tmp-${randomUUID()}`;
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' });
    await fs.rename(temporary, filename);
  } finally {
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function commit(root, plan, stale, backups, manifest) {
  const touched = [];
  try {
    for (const [relative, bytes] of plan) {
      if (backups.get(relative)?.equals(bytes)) continue;
      await atomicWrite(path.join(root, relative), bytes);
      touched.push(relative);
    }
    for (const relative of stale) {
      if (backups.get(relative) === null) continue;
      await fs.unlink(path.join(root, relative));
      touched.push(relative);
    }
    await atomicWrite(path.join(root, manifestName), manifest);
  } catch (error) {
    const failures = [];
    for (const relative of touched.reverse()) {
      try {
        const bytes = backups.get(relative);
        if (bytes) await atomicWrite(path.join(root, relative), bytes);
        else await fs.unlink(path.join(root, relative));
      } catch (rollbackError) { failures.push(`${relative}: ${rollbackError.message}`); }
    }
    if (failures.length) error.message += `；回滚失败：${failures.join('；')}`;
    throw error;
  }
}

export async function buildSite({ root = projectRoot, sourceDir, configPath } = {}) {
  const explicitConfig = configPath !== undefined;
  root = path.resolve(root);
  sourceDir = path.resolve(root, sourceDir || 'source');
  configPath = path.resolve(root, configPath || 'wiki.config.json');
  const rootInfo = await stat(root);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) fail(root, '项目根必须是现存普通目录');
  const sourceInfo = await stat(sourceDir);
  if (!sourceInfo?.isDirectory() || sourceInfo.isSymbolicLink()) fail(sourceDir, '源目录不存在或不是普通目录');
  const actualSource = await fs.realpath(sourceDir);
  for (const reserved of ['pages', 'assets/source']) {
    const output = path.join(root, reserved);
    if (overlap(sourceDir, output) || overlap(actualSource, await physicalPath(output))) fail(sourceDir, `源目录与输出目录 ${reserved} 重叠`);
  }
  const config = await readConfig(configPath, explicitConfig);
  const sources = await collectSources(sourceDir);
  const md = new MarkdownIt({ html: false, typographer: false });
  const documents = new Map();
  for (const [relative, bytes] of sources) if (markdownExtension.test(relative)) documents.set(relative, parseDocument(md, relative, bytes, path.join(sourceDir, relative)));
  const home = config.home === null ? null : config.home === undefined
    ? [...documents.keys()].find(source => source.toLowerCase() === 'index.md') || null
    : safeRelative(config.home, configPath);
  if (home && !documents.has(home)) fail(configPath, `首页源文件不存在：${home}`);
  for (const document of documents.values()) document.output = document.source === home ? 'index.html' : `pages/${document.source.replace(markdownExtension, '.html')}`;
  for (const document of documents.values()) rewriteLinks(document, sources, documents, sourceDir);
  const navigation = navigationFor(config, documents, configPath);
  if (!home) {
    const used = new Set(navigation.map(entry => entry.id));
    navigation.unshift({ source: null, output: 'index.html', title: config.title || '设定 Wiki', label: '首页', id: uniqueID('home', used), headings: [] });
  }
  const plan = new Map();
  for (const [relative, bytes] of sources) plan.set(`assets/source/${relative}`, bytes);
  for (const page of navigation) plan.set(page.output, Buffer.from(renderPage(page, navigation, config, md)));
  const previous = await readManifest(root);
  const backups = await validatePlan(root, plan, previous);
  const files = [...plan.keys()].sort(naturalOrder.compare);
  const sha256 = Object.fromEntries(files.map(file => [file, digest(plan.get(file))]));
  const manifest = Buffer.from(`${JSON.stringify({ version: 1, files, sha256 }, null, 2)}\n`);
  const stale = previous.files.filter(file => !plan.has(file));
  await commit(root, plan, stale, backups, manifest);
  return { root, pages: navigation.length, sources: sources.size, files: files.length, removed: stale.length };
}

function cliOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') return { help: true };
    const key = { '--root': 'root', '--source': 'sourceDir', '--config': 'configPath' }[args[i]];
    if (!key || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`无效参数：${args[i]}；使用 --help 查看用法`);
    options[key] = path.resolve(args[++i]);
  }
  return options;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = cliOptions(process.argv.slice(2));
    if (options.help) console.log('用法：node scripts/build.mjs [--root <项目目录>] [--source <源目录>] [--config <配置文件>]\n默认读取项目下的 source/ 与 wiki.config.json。');
    else {
      const result = await buildSite(options);
      console.log(`已构建 ${result.pages} 个页面，复制 ${result.sources} 个源文件，清理 ${result.removed} 个旧生成物。`);
    }
  } catch (error) { console.error(`构建失败：${error.message}`); process.exitCode = 1; }
}
