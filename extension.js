const vscode = require('vscode');
const { randomBytes } = require('node:crypto');
const { scanWorkspace } = require('./src/app/workspaceScanner');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	// Command: Open in VSCode Panel
	context.subscriptions.push(vscode.commands.registerCommand('stellar-schematic.start', async function () {
		const panel = vscode.window.createWebviewPanel(
			'stellar-schematic',
			'Stellar Schematic',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				localResourceRoots: [
					vscode.Uri.joinPath(context.extensionUri, 'src', 'app', 'frontend'),
					vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'mermaid', 'dist')
				]
			}
		);

		try {
			panel.webview.html = await getWebviewContent(panel.webview, context.extensionUri);
			attachWebviewController(panel);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			vscode.window.showErrorMessage(`Failed to load Stellar Schematic: ${message}`);
		}
	}));

}

function attachWebviewController(panel) {
	const state = {
		autoScanEnabled: false,
		intervalSeconds: 60,
		timer: undefined,
		lastSnapshot: null,
	};

	const syncAutoScanState = () => {
		panel.webview.postMessage({
			type: 'scan:auto-scan-state',
			payload: {
				enabled: state.autoScanEnabled,
				intervalSeconds: state.intervalSeconds,
			},
		});
	};

	const runScan = async () => {
		try {
			const snapshot = await scanWorkspace();
			state.lastSnapshot = snapshot;
			panel.webview.postMessage({
				type: 'scan:result',
				payload: {
					classes: snapshot.classes,
					meta: {
						...snapshot.meta,
						autoScanEnabled: state.autoScanEnabled,
						autoScanIntervalSeconds: state.intervalSeconds,
					},
				},
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown scan error';
			panel.webview.postMessage({
				type: 'scan:error',
				payload: { message },
			});
		}
	};

	const updateAutoScan = () => {
		if (state.timer) {
			clearInterval(state.timer);
			state.timer = undefined;
		}

		if (!state.autoScanEnabled) {
			return;
		}

		state.timer = setInterval(() => {
			void runScan();
		}, state.intervalSeconds * 1000);
	};

	panel.webview.onDidReceiveMessage(async message => {
		switch (message?.type) {
			case 'scan:request':
				await runScan();
				return;
			case 'scan:auto-scan': {
				state.autoScanEnabled = Boolean(message.enabled);
				state.intervalSeconds = clampInterval(message.intervalSeconds);
				updateAutoScan();
				syncAutoScanState();
				if (message.triggerImmediate !== false) {
					await runScan();
				}
				return;
			}
			case 'source:open':
				await openSourceFile(message.filePath, state.lastSnapshot);
				return;
			default:
				return;
		}
	});

	panel.onDidDispose(() => {
		if (state.timer) {
			clearInterval(state.timer);
		}
	});

	void runScan();
	void syncAutoScanState();
}

async function getWebviewContent(webview, extensionUri) {
	const appRootUri = vscode.Uri.joinPath(extensionUri, 'src', 'app', 'frontend');
	const htmlUri = vscode.Uri.joinPath(appRootUri, 'index.html');
	const mermaidUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js')
	);
	const nonce = getNonce();
	const html = Buffer.from(await vscode.workspace.fs.readFile(htmlUri)).toString('utf8');

	return html
		.replaceAll('{{baseHref}}', `${webview.asWebviewUri(appRootUri).toString()}/`)
		.replaceAll('{{cspSource}}', webview.cspSource)
		.replaceAll('{{nonce}}', nonce)
		.replaceAll('{{mermaidSrc}}', mermaidUri.toString());
}

function getNonce() {
	return randomBytes(16).toString('base64');
}

function clampInterval(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return 60;
	}

	return Math.max(5, Math.min(3600, Math.round(parsed)));
}

async function openSourceFile(filePath, snapshot) {
	if (!filePath || !snapshot?.classes?.length) {
		return;
	}

	const workspaceFolders = vscode.workspace.workspaceFolders || [];
	for (const folder of workspaceFolders) {
		const candidate = vscode.Uri.joinPath(folder.uri, ...filePath.split('/'));
		try {
			await vscode.workspace.fs.stat(candidate);
			const document = await vscode.workspace.openTextDocument(candidate);
			await vscode.window.showTextDocument(document, { preview: false });
			return;
		} catch {
			// Try the next workspace folder
		}
	}
}

function deactivate() {
	// No resources to dispose.
}

module.exports = {
	activate,
	deactivate
};
