/**
 * 轻量 Markdown 渲染器（无依赖、默认转义 HTML）。
 * 支持：标题、段落、粗体/斜体/删除线、行内代码、代码块、列表（含任务列表）、
 * 引用、表格、分隔线、链接、图片。
 */

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(url) {
  const u = String(url || '').trim();
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u) || u.startsWith('#')) return u;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(u)) return u;
  return null;
}

function inline(text) {
  // 行内代码先占位，避免内部被再次解析
  const codes = [];
  let out = String(text).replace(/`([^`]+)`/g, (m, c) => {
    const i = codes.length;
    codes.push(c);
    return `\u0000C${i}\u0000`;
  });

  out = escapeHtml(out);

  // 图片
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (m, alt, url) => {
    const safe = safeUrl(url.replace(/&amp;/g, '&'));
    if (!safe) return escapeHtml(alt);
    return `<img src="${safe}" alt="${alt}" loading="lazy" />`;
  });

  // 链接
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (m, label, url) => {
    const safe = safeUrl(url.replace(/&amp;/g, '&'));
    if (!safe) return label;
    return `<a href="${safe}" data-external>${label}</a>`;
  });

  // 粗体 / 斜体 / 删除线
  out = out
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // 纯文本链接
  out = out.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, (m, pre, url) => {
    return `${pre}<a href="${url}" data-external>${url}</a>`;
  });

  // 还原行内代码
  out = out.replace(/\u0000C(\d+)\u0000/g, (m, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
  return out;
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

export function renderMarkdown(source) {
  if (!source) return '';
  let text = String(source).replace(/\r\n?/g, '\n');

  // 提取围栏代码块
  const codeBlocks = [];
  text = text.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (m, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang.trim(), code });
    return `\n\u0000BLOCK${idx}\u0000\n`;
  });

  const lines = text.split('\n');
  const html = [];
  let i = 0;

  const flushParagraph = (buf) => {
    if (!buf.length) return;
    html.push(`<p>${inline(buf.join('\n')).replace(/\n/g, '<br />')}</p>`);
    buf.length = 0;
  };
  let para = [];

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushParagraph(para);
      i += 1;
      continue;
    }

    const block = /^\u0000BLOCK(\d+)\u0000$/.exec(line.trim());
    if (block) {
      flushParagraph(para);
      const b = codeBlocks[Number(block[1])];
      if (b) {
        html.push(
          `<pre><code${b.lang ? ` class="language-${escapeHtml(b.lang)}"` : ''}>${escapeHtml(b.code.replace(/\n$/, ''))}</code></pre>`,
        );
      }
      i += 1;
      continue;
    }

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushParagraph(para);
      const level = h[1].length;
      html.push(`<h${level}>${inline(h[2].replace(/\s+#+\s*$/, ''))}</h${level}>`);
      i += 1;
      continue;
    }

    // 分隔线
    if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line.trim())) {
      flushParagraph(para);
      html.push('<hr />');
      i += 1;
      continue;
    }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushParagraph(para);
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      html.push('<table><thead><tr>');
      for (const c of head) html.push(`<th>${inline(c)}</th>`);
      html.push('</tr></thead><tbody>');
      for (const r of rows) {
        html.push('<tr>');
        for (let c = 0; c < head.length; c += 1) html.push(`<td>${inline(r[c] || '')}</td>`);
        html.push('</tr>');
      }
      html.push('</tbody></table>');
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      flushParagraph(para);
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      html.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // 列表
    if (/^\s*([-*+]|\d+\.)\s+/.test(raw)) {
      flushParagraph(para);
      const ordered = /^\s*\d+\./.test(raw);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const indent = /^\s*/.exec(lines[i])[0].length;
        let content = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '');
        // 收集续行（缩进的非列表行）
        i += 1;
        while (i < lines.length && lines[i].trim() && /^\s{2,}/.test(lines[i]) && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          content += ' ' + lines[i].trim();
          i += 1;
        }
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(content);
        if (task) {
          const checked = task[1].toLowerCase() === 'x';
          items.push(
            `<li class="task"><span class="task-box" aria-hidden="true">${checked ? '✓' : ''}</span><span${checked ? ' style="opacity:.55;text-decoration:line-through"' : ''}>${inline(task[2])}</span></li>`,
          );
        } else {
          items.push(`<li>${inline(content)}</li>`);
        }
        void indent;
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    // 普通段落
    para.push(line);
    i += 1;
  }
  flushParagraph(para);

  return html.join('\n');
}
