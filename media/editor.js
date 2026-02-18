// @ts-nocheck
(function () {
  const vscode = acquireVsCodeApi();

  const richView = document.getElementById('rich-view');
  const sourceView = document.getElementById('source-view');
  const toggleBtn = document.getElementById('btn-toggle');
  const toolbar = document.getElementById('toolbar');

  let currentMarkdown = '';
  let isSourceMode = false;

  // ─── Marked configuration ───
  marked.setOptions({
    gfm: true,
    breaks: true,
  });

  // ─── FIX #1: Sanitize HTML with DOMPurify ───
  function sanitize(html) {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'p', 'br', 'hr',
        'strong', 'em', 'del', 'code', 'pre',
        'ul', 'ol', 'li', 'input',
        'blockquote',
        'a', 'img',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'span', 'div', 'sub', 'sup',
      ],
      ALLOWED_ATTR: [
        'href', 'src', 'alt', 'title', 'target',
        'type', 'checked', 'disabled',
        'class', 'id',
        'align', 'colspan', 'rowspan',
      ],
      ALLOW_DATA_ATTR: false,
    });
  }

  // ─── Render markdown to rich view ───
  function renderMarkdown(md) {
    const rawHtml = marked.parse(md);
    richView.innerHTML = sanitize(rawHtml);
    attachCheckboxListeners();
  }

  // ─── Attach checkbox listeners after render ───
  function attachCheckboxListeners() {
    richView.querySelectorAll('input[type="checkbox"]').forEach((cb, index) => {
      cb.removeAttribute('disabled');
      cb.addEventListener('change', () => {
        toggleCheckbox(index, cb.checked);
      });
    });
  }

  // ─── FIX #7: Toggle checkbox without full re-render ───
  function toggleCheckbox(targetIndex, checked) {
    const lines = currentMarkdown.split('\n');
    let cbIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(\s*[-*+]\s*)\[([ xX])\](.*)/);
      if (match) {
        if (cbIndex === targetIndex) {
          const prefix = match[1];
          const rest = match[3];
          lines[i] = `${prefix}[${checked ? 'x' : ' '}]${rest}`;
          break;
        }
        cbIndex++;
      }
    }

    currentMarkdown = lines.join('\n');
    sendEdit(currentMarkdown);

    // Update only the affected checkbox and its parent li styling
    const checkboxes = richView.querySelectorAll('input[type="checkbox"]');
    const cb = checkboxes[targetIndex];
    if (cb) {
      cb.checked = checked;
      const li = cb.closest('li');
      if (li) {
        if (checked) {
          li.classList.add('checked');
        } else {
          li.classList.remove('checked');
        }
      }
    }
  }

  // ─── Send edit back to VSCode ───
  function sendEdit(text) {
    vscode.postMessage({ type: 'edit', text });
  }

  // ─── FIX #4: Use CSS classes instead of inline styles for toolbar visibility ───
  function updateToolbarMode() {
    if (isSourceMode) {
      document.body.classList.add('source-mode');
    } else {
      document.body.classList.remove('source-mode');
    }
  }

  // ─── Toggle between rich and source view ───
  function toggleView() {
    isSourceMode = !isSourceMode;

    if (isSourceMode) {
      richView.classList.remove('active');
      sourceView.classList.add('active');
      sourceView.value = currentMarkdown;
      toggleBtn.textContent = 'Preview';
      sourceView.focus();
    } else {
      const newText = sourceView.value;
      if (newText !== currentMarkdown) {
        currentMarkdown = newText;
        sendEdit(currentMarkdown);
      }
      sourceView.classList.remove('active');
      richView.classList.add('active');
      renderMarkdown(currentMarkdown);
      toggleBtn.textContent = 'Source';
    }

    updateToolbarMode();
  }

  // ─── Helpers for textarea manipulation ───

  function wrapWithMarker(wrapper, placeholder) {
    const start = sourceView.selectionStart;
    const end = sourceView.selectionEnd;
    const text = sourceView.value;
    const selected = text.substring(start, end);

    if (selected) {
      const replacement = `${wrapper}${selected}${wrapper}`;
      sourceView.value = text.substring(0, start) + replacement + text.substring(end);
      sourceView.selectionStart = start + wrapper.length;
      sourceView.selectionEnd = start + wrapper.length + selected.length;
    } else {
      const insertion = `${wrapper}${placeholder}${wrapper}`;
      sourceView.value = text.substring(0, start) + insertion + text.substring(end);
      sourceView.selectionStart = start + wrapper.length;
      sourceView.selectionEnd = start + wrapper.length + placeholder.length;
    }
    sourceView.focus();
    syncFromSource();
  }

  function prependToCurrentLine(prefix) {
    const start = sourceView.selectionStart;
    const text = sourceView.value;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    sourceView.value = text.substring(0, lineStart) + prefix + text.substring(lineStart);
    sourceView.selectionStart = sourceView.selectionEnd = start + prefix.length;
    sourceView.focus();
    syncFromSource();
  }

  function insertAtCursor(insertion) {
    const start = sourceView.selectionStart;
    const end = sourceView.selectionEnd;
    const text = sourceView.value;
    sourceView.value = text.substring(0, start) + insertion + text.substring(end);
    sourceView.selectionStart = sourceView.selectionEnd = start + insertion.length;
    sourceView.focus();
    syncFromSource();
  }

  function syncFromSource() {
    currentMarkdown = sourceView.value;
    sendEdit(currentMarkdown);
  }

  // ─── Toolbar actions ───
  function applyAction(action) {
    if (action === 'toggle-source') {
      toggleView();
      return;
    }

    if (!isSourceMode) return;

    switch (action) {
      case 'bold':
        wrapWithMarker('**', 'bold text');
        break;
      case 'italic':
        wrapWithMarker('_', 'italic text');
        break;
      case 'strikethrough':
        wrapWithMarker('~~', 'strikethrough');
        break;
      case 'code':
        wrapWithMarker('`', 'code');
        break;
      case 'h1':
        prependToCurrentLine('# ');
        break;
      case 'h2':
        prependToCurrentLine('## ');
        break;
      case 'h3':
        prependToCurrentLine('### ');
        break;
      case 'ul':
        prependToCurrentLine('- ');
        break;
      case 'ol':
        prependToCurrentLine('1. ');
        break;
      case 'checklist':
        prependToCurrentLine('- [ ] ');
        break;
      case 'quote':
        prependToCurrentLine('> ');
        break;
      case 'link': {
        const start = sourceView.selectionStart;
        const end = sourceView.selectionEnd;
        const selected = sourceView.value.substring(start, end);
        if (selected) {
          const replacement = `[${selected}](url)`;
          sourceView.value = sourceView.value.substring(0, start) + replacement + sourceView.value.substring(end);
          sourceView.selectionStart = start + selected.length + 3;
          sourceView.selectionEnd = start + selected.length + 6;
        } else {
          insertAtCursor('[link text](url)');
          const pos = sourceView.selectionEnd;
          sourceView.selectionStart = pos - 16 + 1;
          sourceView.selectionEnd = pos - 16 + 10;
        }
        sourceView.focus();
        syncFromSource();
        break;
      }
      case 'hr':
        insertAtCursor('\n---\n');
        break;
      case 'codeblock':
        insertAtCursor('\n```\ncode\n```\n');
        break;
    }
  }

  // ─── Toolbar click handler ───
  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action) {
      applyAction(action);
    }
  });

  // ─── Source view edit handler (debounced) ───
  let editTimeout;
  sourceView.addEventListener('input', () => {
    clearTimeout(editTimeout);
    editTimeout = setTimeout(() => {
      currentMarkdown = sourceView.value;
      sendEdit(currentMarkdown);
    }, 300);
  });

  // ─── Keyboard shortcuts in source view ───
  sourceView.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      wrapWithMarker('**', 'bold text');
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
      e.preventDefault();
      wrapWithMarker('_', 'italic text');
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      insertAtCursor('  ');
    }
  });

  // ─── Listen for messages from extension ───
  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'update': {
        const isFirstLoad = currentMarkdown === '' && !isSourceMode;
        currentMarkdown = message.text;

        if (isFirstLoad && message.text.trim() === '') {
          isSourceMode = true;
          richView.classList.remove('active');
          sourceView.classList.add('active');
          sourceView.value = currentMarkdown;
          toggleBtn.textContent = 'Preview';
          updateToolbarMode();
          sourceView.focus();
        } else {
          renderMarkdown(currentMarkdown);
          if (isSourceMode) {
            sourceView.value = currentMarkdown;
          }
        }
        break;
      }
    }
  });

  // ─── Initial state ───
  updateToolbarMode();

  // ─── Notify extension we're ready ───
  vscode.postMessage({ type: 'ready' });
})();
