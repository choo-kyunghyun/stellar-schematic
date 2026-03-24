/**
 * Workspace UI - Read-only interface backed by VS Code workspace scans.
 */

class WorkspaceUI {
    constructor(store) {
        this.store = store;
        this.classSearchQuery = '';
        this.deepSearchQuery = '';
        this.deepSearchMatchCase = false;
        this.deepSearchWholeWord = false;
        this.initElements();
        this.graph = new Graph(this.els.mermaidGraph, store, name => this.select(name));
        this.bindGlobal();

        window.addEventListener('message', event => {
            this.handleMessage(event.data);
        });
    }

    initElements() {
        const elementIds = [
            'classes-list', 'details-content', 'details-actions', 'mermaid-graph',
            'class-search-input', 'deep-search-input', 'deep-search-results',
            'deep-match-case-btn', 'deep-whole-word-btn',
            'settings-modal', 'settings-form', 'scan-status', 'scan-interval-input'
        ];

        this.els = {};
        elementIds.forEach(id => {
            const camelCase = id.replace(/-./g, c => c[1].toUpperCase());
            this.els[camelCase] = DOMUtils.$(id);
        });
    }

    bindGlobal() {
        DOMUtils.$('add-new-class-btn').onclick = () => this.store.requestScan();
        DOMUtils.$('import-btn').onclick = () => {
            this.store.setAutoScan(!this.store.scanState.autoScanEnabled, this.store.scanState.autoScanIntervalSeconds);
        };
        DOMUtils.$('export-btn').onclick = () => this.openSelectedSource();
        DOMUtils.$('settings-btn').onclick = () => this.showSettings();

        if (this.els.classSearchInput) {
            this.els.classSearchInput.oninput = e => {
                this.classSearchQuery = (e.target.value || '').trim().toLowerCase();
                this.renderSidebar();
            };
        }

        if (this.els.deepSearchInput) {
            this.els.deepSearchInput.oninput = e => {
                this.deepSearchQuery = (e.target.value || '').trim();
                this.renderDeepSearchResults();
            };
            this.els.deepSearchInput.onfocus = () => {
                if (this.deepSearchQuery) this.renderDeepSearchResults();
            };
        }

        if (this.els.deepMatchCaseBtn) {
            this.els.deepMatchCaseBtn.onclick = () => {
                this.deepSearchMatchCase = !this.deepSearchMatchCase;
                this.els.deepMatchCaseBtn.classList.toggle('is-active', this.deepSearchMatchCase);
                this.els.deepMatchCaseBtn.setAttribute('aria-pressed', String(this.deepSearchMatchCase));
                this.updateDeepSearchOptionLabels();
                this.renderDeepSearchResults();
            };
        }

        if (this.els.deepWholeWordBtn) {
            this.els.deepWholeWordBtn.onclick = () => {
                this.deepSearchWholeWord = !this.deepSearchWholeWord;
                this.els.deepWholeWordBtn.classList.toggle('is-active', this.deepSearchWholeWord);
                this.els.deepWholeWordBtn.setAttribute('aria-pressed', String(this.deepSearchWholeWord));
                this.updateDeepSearchOptionLabels();
                this.renderDeepSearchResults();
            };
        }

        document.addEventListener('click', e => {
            if (!this.els.deepSearchResults) return;
            if (e.target.closest('#deep-search-wrap')) return;
            this.els.deepSearchResults.classList.remove('open');
        });

        this.els.settingsForm.onsubmit = e => this.submitSettings(e);
        DOMUtils.$('cancel-settings-btn').onclick = () => this.els.settingsModal.classList.add('hidden');

        this.updateDeepSearchOptionLabels();
    }

    handleMessage(message) {
        switch (message?.type) {
            case 'scan:result':
                this.store.applySnapshot(message.payload);
                this.refresh();
                return;
            case 'scan:error':
                this.store.applyError(message.payload?.message || 'Unknown scan error');
                this.renderStatus();
                return;
            case 'scan:auto-scan-state':
                this.store.setAutoScanState(message.payload);
                this.renderStatus();
                this.updateToolbar();
                return;
            default:
                return;
        }
    }

    select(name) {
        if (this.store.selectedClass === name) return;
        this.store.selectedClass = name;
        this.updateSidebar();
        this.graph.highlight();
        this.renderDetails();
    }

    refresh() {
        this.renderStatus();
        this.updateToolbar();
        this.renderSidebar();
        this.graph.render();
        this.renderDetails();
    }

    renderStatus() {
        if (!this.els.scanStatus) return;

        const parts = [
            this.store.scanState.workspaceName,
            `${this.store.scanState.fileCount} module${this.store.scanState.fileCount === 1 ? '' : 's'}`,
            this.store.scanState.scannedAt ? `Last scan ${this.formatTimestamp(this.store.scanState.scannedAt)}` : 'Waiting for scan'
        ];

        if (this.store.scanState.autoScanEnabled) {
            parts.push(`Auto scan every ${this.store.scanState.autoScanIntervalSeconds}s`);
        } else {
            parts.push('Auto scan off');
        }

        if (this.store.scanState.parseErrors?.length) {
            parts.push(`${this.store.scanState.parseErrors.length} parse issue${this.store.scanState.parseErrors.length === 1 ? '' : 's'}`);
        }

        if (this.store.scanState.error) {
            parts.push(`Error: ${this.store.scanState.error}`);
            this.els.scanStatus.classList.add('has-error');
        } else {
            this.els.scanStatus.classList.remove('has-error');
        }

        this.els.scanStatus.textContent = parts.join(' | ');
    }

    updateToolbar() {
        const autoScanButton = DOMUtils.$('import-btn');
        const openSourceButton = DOMUtils.$('export-btn');

        if (autoScanButton) {
            autoScanButton.textContent = this.store.scanState.autoScanEnabled
                ? `Auto Scan On (${this.store.scanState.autoScanIntervalSeconds}s)`
                : 'Auto Scan Off';
        }

        if (openSourceButton) {
            openSourceButton.disabled = !this.store.active()?.metadata?.filePath;
        }
    }

    renderSidebar() {
        this.els.classesList.innerHTML = '';
        const query = this.classSearchQuery;
        const classItems = !query
            ? this.store.classes
            : this.store.classes.filter(c => {
                const name = (c.class || '').toLowerCase();
                const desc = (c.description || '').toLowerCase();
                return name.includes(query) || desc.includes(query);
            });

        if (!classItems.length) {
            this.els.classesList.innerHTML = '<p class="search-empty">No matching modules.</p>';
            return;
        }

        classItems.forEach(c => {
            const btn = DOMUtils.el('button', '', c.class);
            btn.dataset.className = c.class;
            btn.onclick = () => this.select(c.class);
            this.els.classesList.appendChild(btn);
        });
        this.updateSidebar();
    }

    updateSidebar() {
        this.els.classesList.querySelectorAll('button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.className === this.store.selectedClass);
        });
    }

    renderDetails() {
        const c = this.store.active();
        if (!c) {
            this.els.detailsContent.innerHTML = '<p>Select a module to see its scan results.</p>';
            this.els.detailsActions.innerHTML = '';
            return;
        }

        const fmt = t => StringUtils.formatType(t, this.store);
        const vars = c.model?.fields?.length
            ? c.model.fields.map(f => `<li>${AccessModifier.badge(f.access)}<strong class="method-name">${f.name}</strong> <span class="type-label">[<span class="type-val">${fmt(f.type)}</span>]</span></li>`).join('')
            : '<p>No fields detected.</p>';

        const methods = c.api?.exposes?.length
            ? c.api.exposes.map(m => {
                const params = (m.inputs || []).map(i => `<span class="param-name">${i.name}</span>:<span class="type-val">${fmt(i.type)}</span>`).join(', ');
                return `<div class="api-method"><div>${AccessModifier.badge(m.access)}<strong class="method-name">${m.name}</strong>(${params}) <span class="type-val">&rarr; ${fmt(m.returns)}</span></div><p>${m.description}</p></div>`;
            }).join('')
            : '<p>No functions or methods detected.</p>';

        const calls = c.api?.calls?.length
            ? c.api.calls.map(call => `
                <div class="api-method">
                    <p><button type="button" class="inline-link-btn" data-target-class="${call.targetClass}">${call.targetClass}</button></p>
                    <p>${call.description}</p>
                </div>
            `).join('')
            : '<p>No local module imports detected.</p>';

        const responsibilities = c.responsibilities?.map(line => `<li>${line}</li>`).join('') || '<p>None.</p>';
        const metadata = c.metadata || {};
        const sourceInfo = `
            <div class="source-panel">
                <h4>Source</h4>
                <ul>
                    <li><strong>Path:</strong> ${metadata.filePath || c.class}</li>
                    <li><strong>Declared classes:</strong> ${(metadata.classes || []).join(', ') || 'None'}</li>
                    <li><strong>Exports:</strong> ${(metadata.exports || []).join(', ') || 'None'}</li>
                    <li><strong>Imports:</strong> ${(metadata.imports || []).join(', ') || 'None'}</li>
                    <li><strong>Parse status:</strong> ${metadata.parseError || 'OK'}</li>
                </ul>
            </div>
        `;

        this.els.detailsContent.innerHTML = `
            <div class="class-header">
                <h3>${c.class}</h3>
                <p>${c.description}</p>
                <p class="readonly-note">Read-only scan result from the current VS Code workspace.</p>
            </div>
            <div class="panels-grid">
                <div class="panel"><h4>Summary</h4><ul>${responsibilities}</ul></div>
                <div class="panel"><h4>Detected Fields</h4><ul>${vars}</ul></div>
                <div class="panel"><h4>Detected Methods</h4><div class="api-list">${methods}</div></div>
                <div class="panel"><h4>Imported Modules</h4><div class="api-list">${calls}</div></div>
            </div>
            ${sourceInfo}
        `;

        this.els.detailsActions.innerHTML = '<button id="open-source-btn">Open Source</button> <button id="rescan-btn">Scan Now</button>';
        DOMUtils.$('open-source-btn').onclick = () => this.openSelectedSource();
        DOMUtils.$('rescan-btn').onclick = () => this.store.requestScan();
        this.els.detailsContent.querySelectorAll('.inline-link-btn').forEach(button => {
            button.onclick = () => this.select(button.dataset.targetClass);
        });
    }

    openSelectedSource() {
        const active = this.store.active();
        if (!active) return;
        this.store.openSource(active.class);
    }

    renderDeepSearchResults() {
        if (!this.els.deepSearchResults) return;

        const query = this.deepSearchQuery;
        if (!query) {
            this.els.deepSearchResults.classList.remove('open');
            this.els.deepSearchResults.innerHTML = '';
            return;
        }

        const matches = this.collectDeepMatches(query).slice(0, 30);
        if (!matches.length) {
            this.els.deepSearchResults.innerHTML = '<div class="deep-search-empty">No matching modules, fields, or methods.</div>';
            this.els.deepSearchResults.classList.add('open');
            return;
        }

        this.els.deepSearchResults.innerHTML = matches.map((item, index) => `
            <button type="button" class="deep-search-item" data-index="${index}" role="option">
                <strong>${DOMUtils.escapeHtml(item.className)}</strong>
                <span>${DOMUtils.escapeHtml(item.kind)}: ${DOMUtils.escapeHtml(item.detail)}</span>
            </button>
        `).join('');

        this.els.deepSearchResults.classList.add('open');
        this.els.deepSearchResults.querySelectorAll('.deep-search-item').forEach(button => {
            button.onclick = () => {
                const match = matches[Number(button.dataset.index)];
                if (!match) return;
                this.select(match.className);
                this.els.deepSearchResults.classList.remove('open');
            };
        });
    }

    collectDeepMatches(query) {
        const q = this.deepSearchMatchCase ? query : query.toLowerCase();
        const results = [];
        const includesQuery = text => {
            const target = this.deepSearchMatchCase ? text : text.toLowerCase();
            if (!this.deepSearchWholeWord) return target.includes(q);
            const pattern = new RegExp(`(^|[^a-zA-Z0-9_])${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-zA-Z0-9_]|$)`);
            return pattern.test(target);
        };

        this.store.classes.forEach(c => {
            if (includesQuery(c.class) || includesQuery(c.description || '')) {
                results.push({ className: c.class, kind: 'Module', detail: c.description || c.class });
            }

            (c.model?.fields || []).forEach(field => {
                const haystack = [field.name, field.type, field.access].join(' ');
                if (includesQuery(haystack)) {
                    results.push({ className: c.class, kind: 'Field', detail: `${field.name} (${field.type})` });
                }
            });

            (c.api?.exposes || []).forEach(method => {
                const inputText = (method.inputs || []).map(i => `${i.name}:${i.type}`).join(' ');
                const haystack = [method.name, method.description, method.returns, method.access, inputText].join(' ');
                if (includesQuery(haystack)) {
                    results.push({ className: c.class, kind: 'Method', detail: method.name });
                }
            });
        });

        return results;
    }

    updateDeepSearchOptionLabels() {
        if (this.els.deepMatchCaseBtn) {
            const state = this.deepSearchMatchCase ? 'ON' : 'OFF';
            this.els.deepMatchCaseBtn.textContent = 'Aa';
            this.els.deepMatchCaseBtn.title = `Match Case (${state})`;
            this.els.deepMatchCaseBtn.setAttribute('aria-label', `Match Case (${state})`);
        }

        if (this.els.deepWholeWordBtn) {
            const state = this.deepSearchWholeWord ? 'ON' : 'OFF';
            this.els.deepWholeWordBtn.textContent = 'Abc';
            this.els.deepWholeWordBtn.title = `Match Whole Word (${state})`;
            this.els.deepWholeWordBtn.setAttribute('aria-label', `Match Whole Word (${state})`);
        }
    }

    showSettings() {
        this.els.scanIntervalInput.value = String(this.store.scanState.autoScanIntervalSeconds || 60);
        this.els.settingsModal.classList.remove('hidden');
    }

    submitSettings(event) {
        event.preventDefault();
        const value = Number(this.els.scanIntervalInput.value);
        const intervalSeconds = Number.isFinite(value) ? Math.max(5, Math.min(3600, Math.round(value))) : 60;
        this.store.setAutoScan(this.store.scanState.autoScanEnabled, intervalSeconds);
        this.els.settingsModal.classList.add('hidden');
    }

    formatTimestamp(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return value;
        }
        return date.toLocaleTimeString();
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
        if (!vscodeApi) {
            throw new Error('VS Code webview API is unavailable.');
        }

        const store = new Store(vscodeApi);
        const ui = new WorkspaceUI(store);

        ui.refresh();
        store.load();
    } catch (error) {
        console.error('Initialization failed:', error);
        const detailsContent = DOMUtils.$('details-content');
        if (detailsContent) {
            detailsContent.innerHTML = '<p class="error-text">Failed to initialize. Check console for details.</p>';
        }
    }
});