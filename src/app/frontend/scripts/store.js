/**
 * Store Class - Centralized state management for workspace scan data
 * Data model: Module = { class: string, inherits: string, model: {fields}, api: {exposes, calls}, metadata: {...} }
 */

class Store {
    constructor(vscodeApi) {
        if (!vscodeApi) {
            throw new Error('VS Code API is not available. This UI must run inside a webview.');
        }

        this.vscode = vscodeApi;
        
        // Scanned modules array
        this.classes = [];
        
        // Available data types from scanner
        this.dataTypes = ['string', 'number', 'boolean', 'object', 'array', 'unknown'];
        
        // Currently selected module
        this.selectedClass = null;
        
        // Scan state metadata
        this.scanState = {
            autoScanEnabled: false,
            autoScanIntervalSeconds: 60,
            workspaceName: 'No folder open',
            fileCount: 0,
            scannedAt: '',
            error: '',
            parseErrors: []
        };
    }

    load() {
        this.requestScan();
    }

    /**
     * Normalize and validate module data from scanner
     * @param {Array} modules - Raw modules from workspace scanner
     * @returns {Array} Normalized modules
     */
    normalizeModules(modules) {
        return (modules || []).map(mod => {
            // Ensure all required fields exist with proper types
            return {
                class: String(mod.class || ''),
                description: String(mod.description || ''),
                responsibilities: Array.isArray(mod.responsibilities) ? mod.responsibilities : [],
                inherits: String(mod.inherits || ''),
                model: {
                    fields: Array.isArray(mod.model?.fields) ? mod.model.fields : []
                },
                api: {
                    exposes: Array.isArray(mod.api?.exposes) ? mod.api.exposes : [],
                    calls: Array.isArray(mod.api?.calls) ? mod.api.calls : []
                },
                metadata: Object(mod.metadata || {})
            };
        });
    }

    requestScan() {
        this.scanState.error = '';
        this.vscode.postMessage({ type: 'scan:request' });
    }

    setAutoScan(enabled, intervalSeconds) {
        const nextEnabled = Boolean(enabled);
        const nextInterval = Math.max(5, Number(intervalSeconds) || 60);
        this.vscode.postMessage({
            type: 'scan:auto-scan',
            enabled: nextEnabled,
            intervalSeconds: nextInterval
        });
    }

    openSource(className) {
        const mod = this.get(className);
        if (!mod?.metadata?.filePath) return;

        this.vscode.postMessage({
            type: 'source:open',
            filePath: mod.metadata.filePath
        });
    }

    /**
     * Apply scan result snapshot
     * @param {Object} payload - { classes: Array, meta: {workspaceName, fileCount, ...} }
     */
    applySnapshot(payload) {
        const modules = this.normalizeModules(payload?.classes || []);
        
        // Preserve selection if still exists
        const nextSelected = modules.some(m => m.class === this.selectedClass)
            ? this.selectedClass
            : modules[0]?.class || null;

        this.classes = modules;
        this.selectedClass = nextSelected;
        this.dataTypes = payload?.meta?.dataTypes || this.dataTypes;
        this.scanState = {
            autoScanEnabled: Boolean(payload?.meta?.autoScanEnabled),
            autoScanIntervalSeconds: Number(payload?.meta?.autoScanIntervalSeconds) || 60,
            workspaceName: String(payload?.meta?.workspaceName || 'Unknown'),
            fileCount: Number(payload?.meta?.fileCount) || 0,
            scannedAt: String(payload?.meta?.scannedAt || ''),
            error: '',
            parseErrors: Array.isArray(payload?.meta?.parseErrors) ? payload.meta.parseErrors : []
        };
    }

    applyError(message) {
        this.scanState.error = String(message || 'Unknown error');
    }

    setAutoScanState(state) {
        this.scanState.autoScanEnabled = Boolean(state?.enabled);
        this.scanState.autoScanIntervalSeconds = Number(state?.intervalSeconds) || this.scanState.autoScanIntervalSeconds;
    }

    /**
     * Get module by class name
     * @param {string} name - Class/module name
     * @returns {Object|undefined}
     */
    get(name) {
        return this.classes.find(m => m.class === name);
    }

    /**
     * Get currently selected module
     * @returns {Object|null}
     */
    active() {
        return this.get(this.selectedClass) || null;
    }

    /**
     * Get all modules that inherit from given module
     * @param {string} name - Parent class/module name
     * @returns {Array}
     */
    childrenOf(name) {
        return this.classes.filter(m => m.inherits === name);
    }
}
