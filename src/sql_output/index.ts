import * as vscode from "vscode";
import { to_sql } from "prql-js";
import * as shiki from "shiki";
import { readFileSync } from "node:fs";
import { CompilationResult, getResourceUri, isPrqlDocument, normalizeThemeName } from "./utils";

function getCompiledTemplate(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const template = readFileSync(getResourceUri(context, "sql_output.html").fsPath, "utf-8");
  const templateJS = getResourceUri(context, "sql_output.js");
  const templateCss = getResourceUri(context, "sql_output.css");

  return (template as string)
    .replace(/##CSP_SOURCE##/g, webview.cspSource)
    .replace("##JS_URI##", webview.asWebviewUri(templateJS).toString())
    .replace("##CSS_URI##", webview.asWebviewUri(templateCss).toString())
}

function getThemeName(): string {
  const currentThemeName = vscode.workspace.getConfiguration("workbench")
    .get<string>("colorTheme", "dark-plus");

  for (const themeName of [currentThemeName, normalizeThemeName(currentThemeName)]) {
    if (shiki.BUNDLED_THEMES.includes(themeName as shiki.Theme)) {
      return themeName;
    }
  }

  return "css-variables";
}

let highlighter: shiki.Highlighter | undefined;

async function getHighlighter(): Promise<shiki.Highlighter> {
  if (highlighter) {
    return Promise.resolve(highlighter);
  }

  return highlighter = await shiki.getHighlighter({ theme: getThemeName() });
}

async function compilePrql(text: string): Promise<CompilationResult> {
  try {
    const sql = to_sql(text);
    const highlighter = await getHighlighter();
    const highlighted = highlighter.codeToHtml(sql ? sql : "", {
      lang: "sql"
    });

    return {
      status: "ok",
      content: highlighted
    };
  } catch (err: any) {
    return {
      status: "error",
      content: err.message.split("\n").slice(1, -1).join("\n")
    };
  }
}

function createWebviewPanel(context: vscode.ExtensionContext, onDidDispose: () => any): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel("prqlSqlOutputPanel", "PRQL - SQL Output",
    {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true
    },
    {
      enableFindWidget: false,
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "resources")]
    }
  );
  panel.webview.html = getCompiledTemplate(context, panel.webview);

  let previousText = "";
  const sendTextIfChanged = (force = false) => {
    const editor = vscode.window.activeTextEditor;

    if (force) {
      compilePrql(previousText).then(result => panel.webview.postMessage(result));
    } else if (panel.visible && editor && isPrqlDocument(editor)) {
      const text = editor.document.getText();

      if (text !== previousText) {
        previousText = text;
        compilePrql(text).then(result => panel.webview.postMessage(result));
      }
    }
  };

  const disposables = [
    vscode.workspace.onDidChangeTextDocument,
    vscode.window.onDidChangeActiveTextEditor,
  ].map(fn => fn(() => sendTextIfChanged()));

  disposables.push(vscode.workspace.onDidChangeConfiguration(() => {
    highlighter = undefined;
    sendTextIfChanged(true);
  }));

  panel.onDidDispose(() => {
    disposables.forEach(d => d.dispose());
    onDidDispose();
  }, undefined, context.subscriptions);

  sendTextIfChanged();

  return panel;
}

export function activateSqlOutputPanel(context: vscode.ExtensionContext) {
  let panel: vscode.WebviewPanel | undefined = undefined;
  let panelViewColumn: vscode.ViewColumn | undefined = undefined;

  const command = vscode.commands.registerCommand("prqlSqlOutputPanel.open", () => {
    if (panel) {
      panel.reveal(panelViewColumn, true);
    } else {
      panel = createWebviewPanel(context, () => panel = undefined);
      panelViewColumn = panel.viewColumn;
    }
  });
  context.subscriptions.push(command);
}
