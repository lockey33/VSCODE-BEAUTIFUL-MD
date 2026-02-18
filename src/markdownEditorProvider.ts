import * as vscode from 'vscode';
import { getNonce } from './util';

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {

  public static readonly viewType = 'mdRichEditor.editor';

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      MarkdownEditorProvider.viewType,
      new MarkdownEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ],
    };

    const styleUri = webviewPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor.css')
    );
    const scriptUri = webviewPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor.js')
    );
    const markedUri = webviewPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'marked.min.js')
    );
    const purifyUri = webviewPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'purify.min.js')
    );

    webviewPanel.webview.html = this.getHtmlForWebview(
      webviewPanel.webview,
      styleUri,
      scriptUri,
      markedUri,
      purifyUri
    );

    // FIX #2: Flag to prevent edit loop (webview edit → doc change → update webview → …)
    let isApplyingWebviewEdit = false;

    const updateWebview = () => {
      webviewPanel.webview.postMessage({
        type: 'update',
        text: document.getText(),
      });
    };

    // FIX #6: Throttle external document changes
    let externalChangeTimeout: ReturnType<typeof setTimeout> | undefined;

    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      if (e.contentChanges.length === 0) return;

      // FIX #2: Skip if we triggered this change ourselves
      if (isApplyingWebviewEdit) return;

      // FIX #6: Debounce external updates (formatters, linters)
      if (externalChangeTimeout) clearTimeout(externalChangeTimeout);
      externalChangeTimeout = setTimeout(() => {
        updateWebview();
      }, 100);
    });

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      if (externalChangeTimeout) clearTimeout(externalChangeTimeout);
    });

    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'edit': {
          const newText: string = message.text;
          const currentText = document.getText();

          // Skip if content is identical
          if (newText === currentText) break;

          // FIX #3: Incremental diff — find minimal changed range
          const edit = new vscode.WorkspaceEdit();
          const { startLine, endLineOld, endLineNew, newLines } = computeLineDiff(currentText, newText);

          edit.replace(
            document.uri,
            new vscode.Range(startLine, 0, endLineOld, currentText.split('\n')[endLineOld]?.length ?? 0),
            newLines
          );

          // FIX #2: Set flag before applying to prevent loop
          isApplyingWebviewEdit = true;
          await vscode.workspace.applyEdit(edit);
          isApplyingWebviewEdit = false;
          break;
        }
        case 'ready': {
          updateWebview();
          break;
        }
      }
    });

    updateWebview();
  }

  private getHtmlForWebview(
    webview: vscode.Webview,
    styleUri: vscode.Uri,
    scriptUri: vscode.Uri,
    markedUri: vscode.Uri,
    purifyUri: vscode.Uri
  ): string {
    const nonce = getNonce();

    // FIX #4: Removed 'unsafe-inline' from style-src, using nonce instead
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
    style-src ${webview.cspSource};
    script-src 'nonce-${nonce}';
    img-src ${webview.cspSource} https: data:;
    font-src ${webview.cspSource};">
  <link href="${styleUri}" rel="stylesheet" />
  <title>Markdown Rich Editor</title>
</head>
<body>
  <div id="toolbar">
    <button data-action="bold" title="Bold (Ctrl+B)" class="toolbar-action"><b>B</b></button>
    <button data-action="italic" title="Italic (Ctrl+I)" class="toolbar-action"><i>I</i></button>
    <button data-action="strikethrough" title="Strikethrough" class="toolbar-action"><s>S</s></button>
    <span class="separator toolbar-action"></span>
    <button data-action="h1" title="Heading 1" class="toolbar-action">H1</button>
    <button data-action="h2" title="Heading 2" class="toolbar-action">H2</button>
    <button data-action="h3" title="Heading 3" class="toolbar-action">H3</button>
    <span class="separator toolbar-action"></span>
    <button data-action="ul" title="Unordered List" class="toolbar-action">&#8226; List</button>
    <button data-action="ol" title="Ordered List" class="toolbar-action">1. List</button>
    <button data-action="checklist" title="Checklist" class="toolbar-action">&#9745; Check</button>
    <span class="separator toolbar-action"></span>
    <button data-action="code" title="Inline Code" class="toolbar-action">&lt;/&gt;</button>
    <button data-action="codeblock" title="Code Block" class="toolbar-action">{ }</button>
    <button data-action="quote" title="Blockquote" class="toolbar-action">"</button>
    <button data-action="link" title="Link" class="toolbar-action">&#128279;</button>
    <button data-action="hr" title="Horizontal Rule" class="toolbar-action">&#8213;</button>
    <span class="separator toolbar-action"></span>
    <button data-action="toggle-source" title="Toggle Source" id="btn-toggle">Source</button>
  </div>

  <div id="editor-container">
    <div id="rich-view" class="active"></div>
    <textarea id="source-view" spellcheck="false"></textarea>
  </div>

  <script nonce="${nonce}" src="${purifyUri}"></script>
  <script nonce="${nonce}" src="${markedUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// FIX #3: Compute minimal line-level diff between two texts
function computeLineDiff(oldText: string, newText: string): {
  startLine: number;
  endLineOld: number;
  endLineNew: number;
  newLines: string;
} {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Find first differing line
  let startLine = 0;
  while (
    startLine < oldLines.length &&
    startLine < newLines.length &&
    oldLines[startLine] === newLines[startLine]
  ) {
    startLine++;
  }

  // Find last differing line (from the end)
  let endOffsetOld = oldLines.length - 1;
  let endOffsetNew = newLines.length - 1;
  while (
    endOffsetOld >= startLine &&
    endOffsetNew >= startLine &&
    oldLines[endOffsetOld] === newLines[endOffsetNew]
  ) {
    endOffsetOld--;
    endOffsetNew--;
  }

  const changedNewLines = newLines.slice(startLine, endOffsetNew + 1).join('\n');

  return {
    startLine,
    endLineOld: Math.max(startLine, endOffsetOld),
    endLineNew: Math.max(startLine, endOffsetNew),
    newLines: changedNewLines,
  };
}
