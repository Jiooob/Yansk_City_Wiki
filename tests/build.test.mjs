import test from 'node:test';
import assert from 'node:assert/strict';
import {
  access, cp, mkdir, mkdtemp, readFile, readdir, rm,
  symlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const builderPath = join(projectRoot, 'scripts', 'build.mjs');
const { buildSite } = await import(pathToFileURL(builderPath).href);
assert.equal(typeof buildSite, 'function', 'scripts/build.mjs exports buildSite');

async function fixture(t, documents, config = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'yansk-builder-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'project');
  await mkdir(join(root, 'source'), { recursive: true });
  for (const [name, contents] of Object.entries(documents)) {
    await put(root, `source/${name}`, contents);
  }
  await put(root, 'wiki.config.json', JSON.stringify({
    title: '测试百科', version: '测试版本', home: 'index.md',
    navigation: [{ source: 'index.md', label: '首页' }], ...config,
  }, null, 2));
  return { root, directory };
}

async function put(root, name, contents) {
  const target = join(root, name);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
  return target;
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}

async function treeBytes(directory) {
  const files = new Map();
  if (!await exists(directory)) return files;
  async function visit(current) {
    for (const item of (await readdir(current, { withFileTypes: true }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = join(current, item.name);
      if (item.isDirectory()) await visit(path);
      else if (item.isFile()) files.set(relative(directory, path), await readFile(path));
    }
  }
  await visit(directory);
  return files;
}

async function outputBytes(root) {
  const files = await treeBytes(root);
  for (const key of files.keys()) {
    if (key === 'wiki.config.json' || key.startsWith(`source${sep}`)) files.delete(key);
  }
  return files;
}

function unescapeAttribute(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt);|&#(?:x[\da-f]+|\d+);/gi, entity => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    return String.fromCodePoint(entity[2].toLowerCase() === 'x'
      ? Number.parseInt(entity.slice(3, -1), 16) : Number.parseInt(entity.slice(2, -1), 10));
  });
}

function tagAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1].toLowerCase()] = unescapeAttribute(match[2] ?? match[3]);
  }
  return attributes;
}

function references(html, tag, attribute) {
  return Array.from(html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'gi')))
    .map(match => tagAttributes(match[0])[attribute])
    .filter(value => value !== undefined);
}

function localReference(file, href) {
  const url = new URL(href, pathToFileURL(file));
  assert.equal(url.protocol, 'file:', `Expected a local output link: ${href}`);
  const hash = decodeURIComponent(url.hash.slice(1));
  url.hash = '';
  return { path: fileURLToPath(url), hash };
}

function assertReference(html, tag, attribute, file, target, hash = undefined) {
  assert.ok(references(html, tag, attribute).some(href => {
    if (/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith('file:')) return false;
    const found = localReference(file, href);
    return found.path === target && (hash === undefined || found.hash === hash);
  }), `${tag}[${attribute}] resolves to ${target}${hash ? `#${hash}` : ''}`);
}

function headingIds(html, title) {
  return Array.from(html.matchAll(/<h[1-6]\b([^>]*)>([\s\S]*?)<\/h[1-6]>/gi))
    .filter(match => match[2].replace(/<[^>]*>/g, '').trim() === title)
    .map(match => tagAttributes(`<h ${match[1]}>`).id);
}

test('recursive Markdown pages, encoded local links, attachments, escaping, and unchanged source bytes', async t => {
  const source = {
    'index.md': '# 首页\n\n[中文章节](lore/%E4%B8%AD%E6%96%87%20%E7%A9%BA%E6%A0%BC.md#%E5%90%8C%E5%90%8D%E6%A0%87%E9%A2%98)\n\n<script>window.__injected = true</script>\n',
    'lore/中文 空格.md': '# 中文章节\n\n## 同名标题\n\n第一段。\n\n## 同名标题\n\n[回首页](../index.md#首页)\n\n![示意图](../images/%E7%A4%BA%E6%84%8F%20%E5%9B%BE.svg)\n\n[附件](../notes/资料.txt)\n\n[外部](https://example.com/readme.md#intro)\n',
    'lore/deep/detail.md': '# 深层章节\n\n[前章](../%E4%B8%AD%E6%96%87%20%E7%A9%BA%E6%A0%BC.md#同名标题-2)\n',
    'images/示意 图.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>图</text></svg>\n'),
    'notes/资料.txt': Buffer.from('原始附件\r\n\x00尾部', 'utf8'),
  };
  const { root } = await fixture(t, source);
  const original = await treeBytes(join(root, 'source'));
  await buildSite({ root });

  const homeFile = join(root, 'index.html');
  const chapterFile = join(root, 'pages/lore/中文 空格.html');
  const detailFile = join(root, 'pages/lore/deep/detail.html');
  const home = await readFile(homeFile, 'utf8');
  const chapter = await readFile(chapterFile, 'utf8');
  const detail = await readFile(detailFile, 'utf8');
  assertReference(home, 'a', 'href', homeFile, chapterFile, '同名标题');
  assertReference(chapter, 'a', 'href', chapterFile, homeFile, '首页');
  assertReference(detail, 'a', 'href', detailFile, chapterFile, '同名标题-2');
  assertReference(chapter, 'img', 'src', chapterFile, join(root, 'assets/source/images/示意 图.svg'));
  assertReference(chapter, 'a', 'href', chapterFile, join(root, 'assets/source/notes/资料.txt'));
  assert.ok(references(chapter, 'a', 'href').includes('https://example.com/readme.md#intro'));
  assert.deepEqual(headingIds(chapter, '同名标题'), ['同名标题', '同名标题-2']);
  assert.ok(headingIds(home, '首页').includes('首页'), 'Chinese heading slugs are preserved');
  assert.ok(home.includes('&lt;script&gt;window.__injected = true&lt;/script&gt;'));
  assert.ok(!/<script\b[^>]*>\s*window\.__injected/gi.test(home), 'source HTML cannot run');
  assert.deepEqual(await treeBytes(join(root, 'source')), original, 'building never changes source bytes');
  for (const [name, bytes] of original) {
    assert.deepEqual(await readFile(join(root, 'assets/source', name)), bytes, `raw copy of ${name}`);
  }
});

test('configured navigation order and labels include newly discovered Markdown', async t => {
  const { root } = await fixture(t, {
    'index.md': '# 首页\n',
    'z-last.md': '# 最后章节\n',
    'a-first.md': '# 新增章节\n',
  }, {
    navigation: [
      { source: 'z-last.md', label: '定制章节', id: 'last' },
      { source: 'index.md', label: '首页入口' },
    ],
  });
  await buildSite({ root });
  for (const name of ['index.html', 'pages/z-last.html', 'pages/a-first.html']) {
    const file = join(root, name);
    const html = await readFile(file, 'utf8');
    const sidebar = html.match(/<nav\b[^>]*id=["']sidebar["'][^>]*>([\s\S]*?)<\/nav>/i)?.[1];
    assert.ok(sidebar, `${name} has a static sidebar`);
    assert.ok(sidebar.indexOf('定制章节') < sidebar.indexOf('首页入口'), 'configured order is used');
    assert.ok(sidebar.includes('新增章节'), 'unlisted Markdown is automatically added');
    assertReference(sidebar, 'a', 'href', file, join(root, 'pages/a-first.html'));
    const current = Array.from(sidebar.matchAll(/<a\b[^>]*>/gi))
      .map(match => tagAttributes(match[0])).filter(attrs => attrs['aria-current'] === 'page');
    assert.equal(current.length, 1, 'exactly one current page marker');
    assert.equal(localReference(file, current[0].href).path, file);
  }
});

test('repeat builds are byte deterministic; stale manifest outputs are removed and handwritten HTML survives', async t => {
  const { root } = await fixture(t, {
    'index.md': '# 首页\n\n正文。\n',
    'chapters/removable.md': '# 待删章节\n',
  });
  await put(root, 'pages/handwritten.html', '<!doctype html><p>手写内容</p>\n');
  const handBytes = await readFile(join(root, 'pages/handwritten.html'));
  const sourceBefore = await treeBytes(join(root, 'source'));
  await buildSite({ root });
  assert.ok(await exists(join(root, '.wiki-generated.json')), 'build tracks its generated files');
  const first = await outputBytes(root);
  await buildSite({ root });
  assert.deepEqual(await outputBytes(root), first, 'second build creates identical bytes');
  assert.deepEqual(await treeBytes(join(root, 'source')), sourceBefore);

  await rm(join(root, 'source/chapters/removable.md'));
  await buildSite({ root });
  assert.equal(await exists(join(root, 'pages/chapters/removable.html')), false);
  assert.equal(await exists(join(root, 'assets/source/chapters/removable.md')), false);
  assert.deepEqual(await readFile(join(root, 'pages/handwritten.html')), handBytes);
  const updatedHome = await readFile(join(root, 'index.html'), 'utf8');
  assert.ok(!updatedHome.includes('removable.html'), 'deleted document leaves navigation');
});

test('sourceDir and configPath overrides build beneath the specified root', async t => {
  const { root } = await fixture(t, { 'index.md': '# 原目录\n' });
  await put(root, 'docs/start.md', '# 自定义首页\n\n[详细](folder/detail.md)\n');
  await put(root, 'docs/folder/detail.md', '# 自定义章节\n');
  const configPath = await put(root, 'config/custom.json', JSON.stringify({
    title: '自定义', home: 'start.md', navigation: [{ source: 'start.md' }],
  }));
  await buildSite({ root, sourceDir: join(root, 'docs'), configPath });
  assert.ok((await readFile(join(root, 'index.html'), 'utf8')).includes('自定义首页'));
  assert.ok(await exists(join(root, 'pages/folder/detail.html')));
  assert.deepEqual(await readFile(join(root, 'assets/source/start.md')), await readFile(join(root, 'docs/start.md')));
});

test('CLI resolves its default project root from the script location, independent of cwd', async t => {
  const { root, directory } = await fixture(t, {
    'index.md': '# CLI首页\n\n脚本位置决定根目录。\n',
    'nested/page.md': '# CLI章节\n',
  });
  await cp(join(projectRoot, 'scripts'), join(root, 'scripts'), { recursive: true });
  if (await exists(join(projectRoot, 'node_modules'))) {
    await symlink(join(projectRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
  }
  const unrelated = join(directory, 'different-cwd');
  await mkdir(unrelated);
  await execute(process.execPath, [join(root, 'scripts/build.mjs')], {
    cwd: unrelated, timeout: 30_000,
  });
  assert.ok((await readFile(join(root, 'index.html'), 'utf8')).includes('CLI首页'));
  assert.ok(await exists(join(root, 'pages/nested/page.html')));
  assert.deepEqual(await readdir(unrelated), [], 'the working directory receives no output');
});

for (const [name, contents] of [
  ['missing .md references', '# 首页\n\n[缺失章节](missing.md#标题)\n'],
  ['missing image attachments', '# 首页\n\n![缺失图片](images/missing.svg)\n'],
]) {
  test(`rejects ${name}`, async t => {
    const { root } = await fixture(t, { 'index.md': contents });
    await assert.rejects(() => buildSite({ root }));
  });
}

test('rejects case-insensitive source/output path collisions', async t => {
  const { root } = await fixture(t, {
    'index.md': '# 首页\n',
    'chapters/Entry.md': '# 第一章\n',
    'Chapters/entry.md': '# 第二章\n',
  });
  await assert.rejects(() => buildSite({ root }));
});

test('rejects source-relative links that escape the source directory', async t => {
  const { root } = await fixture(t, { 'index.md': '# 首页\n\n![越界](../secret.svg)\n' });
  await put(root, 'secret.svg', '<svg>源目录外的文件</svg>');
  await assert.rejects(() => buildSite({ root }));
  assert.equal(await exists(join(root, 'assets/secret.svg')), false);
});

test('rejects a home path escaping the root without writing outside it', async t => {
  const { root, directory } = await fixture(t, { 'index.md': '# 首页\n' }, {
    home: '../../escape.md', navigation: [],
  });
  const outside = await put(directory, 'escape.md', '# 不得写出项目\n');
  const before = await readFile(outside);
  await assert.rejects(() => buildSite({ root }));
  assert.deepEqual(await readFile(outside), before);
  assert.equal(await exists(join(directory, 'escape.html')), false);
});

test('output-directory symlinks cannot redirect generated files outside the root', async t => {
  const { root, directory } = await fixture(t, {
    'index.md': '# 首页\n', 'escape.md': '# 越界章节\n',
  });
  const external = join(directory, 'external-output');
  await mkdir(external);
  await put(external, 'keep.txt', '保留');
  await symlink(external, join(root, 'pages'), 'dir');
  const before = await treeBytes(external);
  await assert.rejects(() => buildSite({ root }));
  assert.deepEqual(await treeBytes(external), before, 'no generated bytes escape through a symlink');
});

test('missing configuration and index Markdown produce an automatic home linking discovered documents', async t => {
  const { root } = await fixture(t, {
    'chapter.md': '# 自动发现章节\n\n正文。\n',
    'nested/detail.md': '# 深层内容\n',
  });
  await rm(join(root, 'wiki.config.json'));
  const sourceBefore = await treeBytes(join(root, 'source'));
  await buildSite({ root });
  const homeFile = join(root, 'index.html');
  const home = await readFile(homeFile, 'utf8');
  assertReference(home, 'a', 'href', homeFile, join(root, 'pages/chapter.html'));
  assertReference(home, 'a', 'href', homeFile, join(root, 'pages/nested/detail.html'));
  assert.ok((await readFile(join(root, 'pages/chapter.html'), 'utf8')).includes('自动发现章节'));
  assert.ok((await readFile(join(root, 'pages/nested/detail.html'), 'utf8')).includes('深层内容'));
  assert.deepEqual(await treeBytes(join(root, 'source')), sourceBefore, 'automatic home never creates or changes source Markdown');
});

for (const problem of ['configuration', 'Markdown link']) {
  test(`${problem} validation errors leave all existing output bytes unchanged`, async t => {
    const { root } = await fixture(t, {
      'index.md': '# 首页\n\n旧的首页内容。\n',
      'chapter.md': '# 章节\n\n旧的章节内容。\n',
    });
    await put(root, 'pages/handwritten.html', '<p>手写保留页</p>');
    await buildSite({ root });
    const before = await outputBytes(root);
    // A valid source update would alter output, making any premature write
    // observable when the separate invalid input aborts the build.
    await put(root, 'source/index.md', '# 首页\n\n新版首页本应重新生成。\n');
    if (problem === 'configuration') {
      await put(root, 'wiki.config.json', '{"title":');
    } else {
      await put(root, 'source/chapter.md', '# 章节\n\n[不存在的文档](missing.md)\n');
    }
    await assert.rejects(() => buildSite({ root }));
    assert.deepEqual(await outputBytes(root), before, 'validation completes before any generated file or manifest is changed');
  });
}

test('manual edits to generated HTML cause a conflict without overwriting any existing output', async t => {
  const { root } = await fixture(t, {
    'index.md': '# 首页\n\n初始首页。\n',
    'chapter.md': '# 章节\n\n初始章节。\n',
  });
  await buildSite({ root });
  const generatedFile = join(root, 'pages/chapter.html');
  const originalHtml = await readFile(generatedFile);
  await writeFile(generatedFile, Buffer.concat([originalHtml, Buffer.from('\n<!-- 人工修改，必须保留 -->\n')]));
  await put(root, 'source/index.md', '# 首页\n\n首页内容也已更新。\n');
  await put(root, 'source/chapter.md', '# 章节\n\n源文件请求覆盖时应发现冲突。\n');
  const outputBefore = await outputBytes(root);
  const sourceBefore = await treeBytes(join(root, 'source'));
  await assert.rejects(() => buildSite({ root }));
  assert.deepEqual(await outputBytes(root), outputBefore, 'a manual-edit conflict leaves every output and manifest unchanged');
  assert.deepEqual(await treeBytes(join(root, 'source')), sourceBefore);
});
