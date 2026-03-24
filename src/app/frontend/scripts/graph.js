/**
 * Graph Class - Mermaid Diagram Rendering with Zoom & Pan
 */

const DOMUtils = {
    $: id => document.getElementById(id),
    $$: (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel)),
    el: (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html) e.innerHTML = html;
        return e;
    },
    escapeHtml: value => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
};

const StringUtils = {
    safeId: s => s.replace(/[^a-zA-Z0-9_]/g, ''),
    formatType: (type, store) => {
        if (!type) return 'unknown';
        if (type.startsWith('ref_')) {
            const className = type.slice(4);
            const classObj = store.get(className);
            return `Ref&lt;${classObj?.class || className}&gt;`;
        }
        return type;
    }
};

const AccessModifier = {
    sym: { public: '+', protected: '#', private: '-' },
    col: { public: '#22c55e', protected: '#f59e0b', private: '#ef4444' },

    badge: (access = 'public') =>
        `<span class="access-badge" style="color:${AccessModifier.col[access]}" title="${access}">${AccessModifier.sym[access]}</span>`
};

class Graph {
    constructor(container, store, onClick) {
        this.container = container;
        this.store = store;
        this.onClick = onClick;
        
        // Zoom state
        this.zoom = 1;
        this.minZoom = 0.5;
        this.maxZoom = 3;
        this.zoomStep = 0.1;
        
        // Pan state
        this.isPanning = false;
        this.panStartX = 0;
        this.panStartY = 0;
        this.panStartScrollLeft = 0;
        this.panStartScrollTop = 0;
        this.panPointerId = null;
        
        // SVG reference
        this.svg = null;
        this.canvasEl = null;
        
        // Binding flags
        this.boundControllers = false;
        this.boundGraph = false;
    }

    /**
     * Main render method
     */
    async render() {
        if (!this.store.classes.length) {
            this.container.innerHTML = '<p style="padding: 2rem; text-align: center; color: var(--vscode-descriptionForeground);">No classes to display.</p>';
            return;
        }

        // Generate Mermaid definition
        let definition = this.generateMermaidDefinition();

        try {
            // Render with Mermaid
            const { svg } = await mermaid.render('mermaid-svg-' + Date.now(), definition);

            // Insert SVG inside a large scrollable workspace canvas.
            this.container.innerHTML = '';
            this.canvasEl = document.createElement('div');
            this.canvasEl.className = 'graph-canvas';
            this.canvasEl.innerHTML = svg;
            this.container.appendChild(this.canvasEl);
            
            // Setup graph interactions
            this.setupGraph();
            this.reset();
        } catch(error) {
            console.error('Mermaid render error:', error);
            this.container.innerHTML = '<p style="padding: 2rem; text-align: center; color: var(--vscode-errorForeground);">Could not render graph.</p>';
        }
    }

    /**
     * Generate Mermaid diagram definition
     */
    generateMermaidDefinition() {
        let definition = 'graph TD\n';
        const incomingTargets = new Set();
        const outgoingTargets = new Set();

        // Identify relationships
        this.store.classes.forEach(c => {
            if (c.inherits) {
                incomingTargets.add(c.inherits);
                outgoingTargets.add(c.class);
            }

            (c.api?.calls || []).forEach(call => {
                if (!call.targetClass) return;
                incomingTargets.add(call.targetClass);
                outgoingTargets.add(c.class);
            });
        });

        // Separate related and standalone classes
        const standaloneClasses = [];
        const relatedClasses = [];

        this.store.classes.forEach(c => {
            const hasRelation = incomingTargets.has(c.class) || outgoingTargets.has(c.class);
            if (hasRelation) {
                relatedClasses.push(c);
            } else {
                standaloneClasses.push(c);
            }
        });

        // Add related classes and their connections
        relatedClasses.forEach(c => {
            const id = StringUtils.safeId(c.class);
            const label = DOMUtils.escapeHtml(c.class).replace(/"/g, '\\"');
            definition += `    ${id}["${label}"]\n`;

            if (c.inherits) {
                const inheritId = StringUtils.safeId(c.inherits);
                definition += `    ${id} ==>|inherits| ${inheritId}\n`;
            }

            const callTargets = new Set((c.api?.calls || []).map(call => call.targetClass).filter(Boolean));
            callTargets.forEach(target => {
                const callId = StringUtils.safeId(target);
                definition += `    ${id} -.->|calls| ${callId}\n`;
            });
        });

        // Add standalone classes in a subgraph
        if (standaloneClasses.length) {
            definition += '    subgraph sg["Standalone Modules"]\n';
            definition += '        direction TB\n';

            standaloneClasses.forEach(c => {
                const id = StringUtils.safeId(c.class);
                const label = DOMUtils.escapeHtml(c.class).replace(/"/g, '\\"');
                definition += `        ${id}["${label}"]\n`;
            });

            definition += '    end\n';
        }

        // Styling (using hex colors instead of CSS variables for Mermaid compatibility)
        definition += '    classDef default fill:#1e1e1e,stroke:#d4d4d4,stroke-width:2px,color:#d4d4d4,rx:6px,ry:6px\n';
        definition += '    classDef standaloneGroup fill:#252526,stroke:#3a3a3a,stroke-width:1px,color:#d4d4d4\n';

        return definition;
    }

    /**
     * Setup graph DOM and bindings
     */
    setupGraph() {
        this.svg = this.container.querySelector('svg');
        if (!this.svg) return;

        // Wrap SVG in a group for transformations if needed
        this.svg.setAttribute('style', 'display: block;');
        
        // Bind node click events
        this.svg.querySelectorAll('.node').forEach(node => {
            node.style.cursor = 'pointer';
            node.addEventListener('click', e => this.onNodeClick(e, node));
            node.addEventListener('mouseenter', () => node.style.opacity = '0.7');
            node.addEventListener('mouseleave', () => node.style.opacity = '1');
        });

        // Bind pan and zoom controls
        if (!this.boundGraph) {
            this.bindPanControls();
            this.bindZoomControls();
            this.boundGraph = true;
        }
    }

    /**
     * Handle node click
     */
    onNodeClick(e, node) {
        e.stopPropagation();
        const label = node.textContent?.trim();
        const classObj = this.store.classes.find(c => c.class === label);
        if (classObj) {
            this.onClick(classObj.class);
            this.highlight();
        }
    }

    /**
     * Bind mouse wheel zoom controls
     */
    bindZoomControls() {
        if (this.boundControllers) return;

        const zoomInBtn = DOMUtils.$('graph-zoom-in');
        const zoomOutBtn = DOMUtils.$('graph-zoom-out');
        const resetBtn = DOMUtils.$('graph-zoom-reset');
        const slider = DOMUtils.$('graph-zoom-slider');

        if (zoomInBtn) {
            zoomInBtn.onclick = () => this.setZoom(this.zoom + this.zoomStep, true);
        }
        if (zoomOutBtn) {
            zoomOutBtn.onclick = () => this.setZoom(this.zoom - this.zoomStep, true);
        }
        if (resetBtn) {
            resetBtn.onclick = () => this.reset();
        }
        if (slider) {
            slider.min = String(Math.round(this.minZoom * 100));
            slider.max = String(Math.round(this.maxZoom * 100));
            slider.value = String(Math.round(this.zoom * 100));
            slider.oninput = e => {
                const value = Number(e.target.value);
                if (!Number.isNaN(value)) {
                    this.setZoom(value / 100, true);
                }
            };
        }

        // Mouse wheel zoom
        this.container.addEventListener('wheel', e => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            const delta = -e.deltaY / 100;
            this.setZoom(this.zoom + delta * this.zoomStep, true);
        }, { passive: false });

        this.boundControllers = true;
    }

    /**
     * Bind pan controls (mouse drag)
     */
    bindPanControls() {
        this.container.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            if (e.target.closest('.node')) return;

            this.isPanning = true;
            this.panPointerId = e.pointerId;
            this.panStartX = e.clientX;
            this.panStartY = e.clientY;
            this.panStartScrollLeft = this.container.scrollLeft;
            this.panStartScrollTop = this.container.scrollTop;

            this.container.classList.add('is-panning');
            this.container.setPointerCapture(e.pointerId);
        });

        this.container.addEventListener('pointermove', e => {
            if (!this.isPanning || e.pointerId !== this.panPointerId) return;

            const deltaX = e.clientX - this.panStartX;
            const deltaY = e.clientY - this.panStartY;

            this.container.scrollLeft = this.panStartScrollLeft - deltaX;
            this.container.scrollTop = this.panStartScrollTop - deltaY;
        });

        const endPan = e => {
            if (!this.isPanning || e.pointerId !== this.panPointerId) return;
            this.isPanning = false;
            this.panPointerId = null;
            this.container.classList.remove('is-panning');
            this.container.releasePointerCapture(e.pointerId);
        };

        this.container.addEventListener('pointerup', endPan);
        this.container.addEventListener('pointercancel', endPan);
    }

    /**
     * Set zoom level
     */
    setZoom(nextZoom) {
        nextZoom = Math.max(this.minZoom, Math.min(this.maxZoom, nextZoom));

        if (this.svg) {
            const scaleRatio = nextZoom / this.zoom;
            const centerX = this.container.scrollLeft + this.container.clientWidth / 2;
            const centerY = this.container.scrollTop + this.container.clientHeight / 2;

            this.zoom = nextZoom;
            this.applySVGZoom();

            // Maintain center position during zoom
            this.container.scrollLeft = (centerX * scaleRatio) - this.container.clientWidth / 2;
            this.container.scrollTop = (centerY * scaleRatio) - this.container.clientHeight / 2;
        } else {
            this.zoom = nextZoom;
        }

        this.updateZoomDisplay();
    }

    /**
     * Apply SVG zoom transformation
     */
    applySVGZoom() {
        if (!this.svg) return;

        const originalWidth = this.svg.getAttribute('data-original-width');
        const originalHeight = this.svg.getAttribute('data-original-height');

        if (originalWidth && originalHeight) {
            this.svg.setAttribute('width', String(parseFloat(originalWidth) * this.zoom));
            this.svg.setAttribute('height', String(parseFloat(originalHeight) * this.zoom));
            this.updateCanvasSize();
        }
    }

    /**
     * Keep a large internal canvas so users can pan around dense graphs.
     */
    updateCanvasSize() {
        if (!this.canvasEl || !this.svg) return;

        const width = parseFloat(this.svg.getAttribute('width')) || 0;
        const height = parseFloat(this.svg.getAttribute('height')) || 0;
        const minWorkspaceWidth = Math.max(this.container.clientWidth * 2, 2000);
        const minWorkspaceHeight = Math.max(this.container.clientHeight * 2, 1400);
        const canvasWidth = Math.max(width + 800, minWorkspaceWidth);
        const canvasHeight = Math.max(height + 800, minWorkspaceHeight);

        this.canvasEl.style.width = `${Math.round(canvasWidth)}px`;
        this.canvasEl.style.height = `${Math.round(canvasHeight)}px`;
    }

    /**
     * Update zoom level display
     */
    updateZoomDisplay() {
        const zoomLevel = DOMUtils.$('graph-zoom-level');
        if (zoomLevel) {
            zoomLevel.textContent = `${Math.round(this.zoom * 100)}%`;
        }

        const slider = DOMUtils.$('graph-zoom-slider');
        if (slider) {
            slider.value = String(Math.round(this.zoom * 100));
        }
    }

    /**
     * Reset zoom and centering
     */
    reset() {
        if (this.svg) {
            // Store original dimensions
            let width = parseFloat(this.svg.getAttribute('width'));
            let height = parseFloat(this.svg.getAttribute('height'));

            if (!width || !height) {
                const viewBox = this.svg.viewBox?.baseVal;
                if (viewBox) {
                    width = viewBox.width;
                    height = viewBox.height;
                } else {
                    const box = this.svg.getBBox?.();
                    if (box) {
                        width = box.width;
                        height = box.height;
                    } else {
                        width = 800;
                        height = 600;
                    }
                }
            }

            // Store original dimensions for later scaling
            this.svg.setAttribute('data-original-width', String(width));
            this.svg.setAttribute('data-original-height', String(height));

            // Keep natural scale; do not auto-shrink to panel size.
            this.zoom = 1;

            this.applySVGZoom();
        }

        this.centerView();
        this.updateZoomDisplay();
        this.highlight();
    }

    /**
     * Center view
     */
    centerView() {
        if (this.container.scrollWidth > this.container.clientWidth) {
            this.container.scrollLeft = (this.container.scrollWidth - this.container.clientWidth) / 2;
        }
        if (this.container.scrollHeight > this.container.clientHeight) {
            this.container.scrollTop = (this.container.scrollHeight - this.container.clientHeight) / 2;
        }
    }

    /**
     * Highlight selected node
     */
    highlight() {
        if (!this.svg || !this.store.selectedClass) return;

        const target = StringUtils.safeId(this.store.selectedClass);
        this.svg.querySelectorAll('.node').forEach(node => {
            const isActive = node.id === target || node.id.includes(target);
            if (isActive) {
                node.classList.add('active-node');
            } else {
                node.classList.remove('active-node');
            }
        });
    }
}
