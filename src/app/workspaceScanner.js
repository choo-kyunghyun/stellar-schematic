const path = require('node:path');
const vscode = require('vscode');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const SOURCE_GLOB = '**/*.{js,cjs,mjs,jsx}';
const EXCLUDE_GLOB = '**/{node_modules,dist,build,coverage,.git,.next,out}/**';
const DEFAULT_DATA_TYPES = ['string', 'number', 'boolean', 'object', 'array', 'unknown'];

async function scanWorkspace() {
	const workspaceFolders = vscode.workspace.workspaceFolders || [];
	if (!workspaceFolders.length) {
		return {
			classes: [],
			meta: {
				workspaceName: 'No folder open',
				workspaceFolderCount: 0,
				fileCount: 0,
				scannedAt: new Date().toISOString(),
				parseErrors: []
			},
		};
	}

	const summaries = [];
	for (const folder of workspaceFolders) {
		const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, SOURCE_GLOB), EXCLUDE_GLOB);
		for (const uri of files) {
			summaries.push(await scanFile(folder, uri));
		}
	}

	const classes = summaries
		.sort((left, right) => left.filePath.localeCompare(right.filePath))
		.map(summary => summaryToGraphNode(summary));

	return {
		classes,
		meta: {
			workspaceName: workspaceFolders.length === 1 ? workspaceFolders[0].name : `${workspaceFolders.length} workspace folders`,
			workspaceFolderCount: workspaceFolders.length,
			fileCount: classes.length,
			scannedAt: new Date().toISOString(),
			parseErrors: summaries.filter(summary => summary.parseError).map(summary => ({
				filePath: summary.filePath,
				message: summary.parseError,
			})),
			dataTypes: DEFAULT_DATA_TYPES,
		},
	};
}

async function scanFile(workspaceFolder, fileUri) {
	const content = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf8');
	const filePath = normalizeRelativePath(path.relative(workspaceFolder.uri.fsPath, fileUri.fsPath));
	const importTargets = new Map();
	const importedBindings = new Map();
	const exportedNames = new Set();
	const classNames = new Set();
	const topLevelFunctions = new Set();
	const topLevelVariables = new Set();
	const methods = [];
	const fields = [];
	const inheritanceTargets = new Set();

	let parseError = null;

	try {
		const ast = parser.parse(content, {
			sourceType: 'unambiguous',
			plugins: [
				'jsx',
				'classProperties',
				'classPrivateProperties',
				'classPrivateMethods',
				'dynamicImport',
				'optionalChaining',
				'nullishCoalescingOperator',
			],
		});

		traverse(ast, {
			ImportDeclaration(traversalPath) {
				const target = resolveImport(filePath, traversalPath.node.source.value);
				if (!target) {
					return;
				}

				const names = traversalPath.node.specifiers.map(specifier => specifier.local.name);
				mergeImport(importTargets, target, names, 'import');
				for (const specifier of traversalPath.node.specifiers) {
					importedBindings.set(specifier.local.name, target);
				}
			},

			ExportNamedDeclaration(traversalPath) {
				const declaration = traversalPath.node.declaration;
				if (declaration?.type === 'FunctionDeclaration' && declaration.id?.name) {
					exportedNames.add(declaration.id.name);
				}
				if (declaration?.type === 'ClassDeclaration' && declaration.id?.name) {
					exportedNames.add(declaration.id.name);
				}
				if (declaration?.type === 'VariableDeclaration') {
					for (const declarator of declaration.declarations) {
						collectVariableNames(declarator.id, exportedNames);
					}
				}
				for (const specifier of traversalPath.node.specifiers || []) {
					exportedNames.add(specifier.exported.name || specifier.exported.value);
				}

				if (traversalPath.node.source?.value) {
					const target = resolveImport(filePath, traversalPath.node.source.value);
					if (target) {
						mergeImport(importTargets, target, ['re-export'], 're-export');
					}
				}
			},

			ExportAllDeclaration(traversalPath) {
				const target = resolveImport(filePath, traversalPath.node.source.value);
				if (target) {
					mergeImport(importTargets, target, ['*'], 're-export');
				}
			},

			ExportDefaultDeclaration(traversalPath) {
				const declaration = traversalPath.node.declaration;
				if (declaration?.id?.name) {
					exportedNames.add(declaration.id.name);
				} else {
					exportedNames.add('default');
				}
			},

			CallExpression(traversalPath) {
				if (isRequireCall(traversalPath.node)) {
					const source = traversalPath.node.arguments[0].value;
					const target = resolveImport(filePath, source);
					if (!target) {
						return;
					}

					mergeImport(importTargets, target, ['require'], 'require');
					const declarator = traversalPath.findParent(parent => parent.isVariableDeclarator());
					if (declarator?.node?.id) {
						collectVariableNames(declarator.node.id, importedBindings, target);
					}
				}
			},

			Import(traversalPath) {
				const callExpression = traversalPath.parentPath;
				const [arg] = callExpression?.node?.arguments || [];
				if (!arg || arg.type !== 'StringLiteral') {
					return;
				}

				const target = resolveImport(filePath, arg.value);
				if (target) {
					mergeImport(importTargets, target, ['dynamic import'], 'dynamic');
				}
			},

			FunctionDeclaration(traversalPath) {
				if (traversalPath.parent.type === 'Program' && traversalPath.node.id?.name) {
					topLevelFunctions.add(traversalPath.node.id.name);
				}
			},

			VariableDeclaration(traversalPath) {
				if (traversalPath.parent.type !== 'Program') {
					return;
				}

				for (const declarator of traversalPath.node.declarations) {
					collectVariableNames(declarator.id, topLevelVariables);
				}
			},

			ClassDeclaration(traversalPath) {
				if (traversalPath.parent.type !== 'Program' && traversalPath.parent.type !== 'ExportNamedDeclaration' && traversalPath.parent.type !== 'ExportDefaultDeclaration') {
					return;
				}

				const className = traversalPath.node.id?.name || '(anonymous class)';
				classNames.add(className);

				const superName = getSimpleName(traversalPath.node.superClass);
				if (superName && importedBindings.has(superName)) {
					inheritanceTargets.add(importedBindings.get(superName));
				}

				for (const member of traversalPath.node.body.body) {
					if ((member.type === 'ClassMethod' || member.type === 'ClassPrivateMethod') && member.kind !== 'constructor') {
						methods.push({
							className,
							name: `${className}.${getMemberName(member.key)}`,
							inputs: member.params.map((param, index) => ({
								name: getParameterName(param, index),
								type: 'unknown',
							})),
							access: member.accessibility || (member.type === 'ClassPrivateMethod' ? 'private' : 'public'),
						});
					}

					if (member.type === 'ClassProperty' || member.type === 'ClassPrivateProperty') {
						fields.push({
							className,
							name: `${className}.${getMemberName(member.key)}`,
							access: member.accessibility || (member.type === 'ClassPrivateProperty' ? 'private' : 'public'),
						});
					}
				}
			},
		});
	} catch (error) {
		parseError = error instanceof Error ? error.message : 'Unknown parse error';
	}

	return {
		filePath,
		classNames: Array.from(classNames),
		topLevelFunctions: Array.from(topLevelFunctions),
		topLevelVariables: Array.from(topLevelVariables),
		methods,
		fields,
		exportedNames: Array.from(exportedNames),
		importTargets: Array.from(importTargets.entries()).map(([target, detail]) => ({ target, ...detail })),
		inherits: Array.from(inheritanceTargets),
		parseError,
	};
}

/**
 * Convert file summary to graph node
 * @type {function(Object): {class: string, description: string, responsibilities: Array, inherits: string, model: {fields: Array}, api: {exposes: Array, calls: Array}, metadata: Object}}
 */
function summaryToGraphNode(summary) {
	// Build human-readable summary
	const classSummary = summary.classNames.length
		? `Classes: ${summary.classNames.join(', ')}`
		: 'No classes';
	const functionSummary = summary.topLevelFunctions.length
		? `Functions: ${summary.topLevelFunctions.join(', ')}`
		: 'No functions';
	const exportSummary = summary.exportedNames.length
		? `Exports: ${summary.exportedNames.join(', ')}`
		: 'Exports: none';
	const importsSummary = summary.importTargets.length
		? `${summary.importTargets.length} local import${summary.importTargets.length === 1 ? '' : 's'}`
		: 'No local imports';

	return {
		class: summary.filePath,
		description: summary.parseError
			? `Module at ${summary.filePath} (parse errors)`
			: `Module at ${summary.filePath}`,
		responsibilities: [
			classSummary,
			functionSummary,
			exportSummary,
			importsSummary,
		],
		inherits: summary.inherits[0] || '',
		model: {
			fields: buildFields(summary),
		},
		api: {
			exposes: buildMethods(summary),
			calls: summary.importTargets.map(target => ({
				targetClass: target.target,
				methodId: '',
				description: `${target.kind} ${target.names.length ? target.names.join(', ') : 'module'}`,
			})),
		},
		metadata: {
			filePath: summary.filePath,
			classes: summary.classNames,
			exports: summary.exportedNames,
			imports: summary.importTargets.map(target => target.target),
			parseError: summary.parseError,
		},
	};
}

function buildFields(summary) {
	const variableFields = summary.topLevelVariables.map(name => ({
		name,
		type: 'unknown',
		access: 'public',
	}));

	const classFields = summary.fields.map(field => ({
		name: field.name,
		type: 'unknown',
		access: normalizeAccess(field.access),
	}));

	return [...variableFields, ...classFields].slice(0, 50);
}

function buildMethods(summary) {
	const topLevelMethods = summary.topLevelFunctions.map(name => ({
		id: `${safeId(summary.filePath)}_${safeId(name)}`,
		name,
		description: `Top-level function declared in ${summary.filePath}`,
		inputs: [],
		returns: 'unknown',
		access: 'public',
	}));

	const classMethods = summary.methods.map(method => ({
		id: `${safeId(summary.filePath)}_${safeId(method.name)}`,
		name: method.name,
		description: `Method declared in ${summary.filePath}`,
		inputs: method.inputs,
		returns: 'unknown',
		access: normalizeAccess(method.access),
	}));

	return [...topLevelMethods, ...classMethods].slice(0, 75);
}

function mergeImport(importTargets, target, names, kind) {
	if (target === null) {
		return;
	}

	const existing = importTargets.get(target) || { names: new Set(), kind };
	for (const name of names) {
		existing.names.add(name);
	}
	if (existing.kind !== kind) {
		existing.kind = 'mixed';
	}
	importTargets.set(target, existing);
}

function collectVariableNames(pattern, output, value) {
	if (!pattern) {
		return;
	}

	if (pattern.type === 'Identifier') {
		if (output instanceof Map) {
			output.set(pattern.name, value);
		} else {
			output.add(pattern.name);
		}
		return;
	}

	if (pattern.type === 'ObjectPattern') {
		for (const property of pattern.properties) {
			collectVariableNames(property.value || property.argument, output, value);
		}
	}

	if (pattern.type === 'ArrayPattern') {
		for (const element of pattern.elements) {
			collectVariableNames(element, output, value);
		}
	}

	if (pattern.type === 'AssignmentPattern') {
		collectVariableNames(pattern.left, output, value);
	}

	if (pattern.type === 'RestElement') {
		collectVariableNames(pattern.argument, output, value);
	}
}

function resolveImport(fromFilePath, specifier) {
	if (!specifier || !specifier.startsWith('.')) {
		return null;
	}

	const baseDir = path.posix.dirname(fromFilePath);
	const resolved = normalizeRelativePath(path.posix.normalize(path.posix.join(baseDir, specifier)));
	if (/\.[cm]?jsx?$/.test(resolved)) {
		return resolved;
	}

	return `${resolved}.js`;
}

function normalizeRelativePath(value) {
	return value.split(path.sep).join('/');
}

function normalizeAccess(value) {
	if (value === 'protected' || value === 'private') {
		return value;
	}
	return 'public';
}

function getSimpleName(node) {
	if (!node) {
		return '';
	}

	if (node.type === 'Identifier') {
		return node.name;
	}

	if (node.type === 'MemberExpression' && node.property.type === 'Identifier') {
		return node.property.name;
	}

	return '';
}

function getMemberName(node) {
	if (!node) {
		return 'unknown';
	}

	if (node.type === 'Identifier' || node.type === 'PrivateName') {
		return node.id ? `#${node.id.name}` : node.name;
	}

	if (node.type === 'StringLiteral') {
		return node.value;
	}

	return 'computed';
}

function getParameterName(node, index) {
	if (!node) {
		return `arg${index + 1}`;
	}

	if (node.type === 'Identifier') {
		return node.name;
	}

	if (node.type === 'AssignmentPattern') {
		return getParameterName(node.left, index);
	}

	if (node.type === 'RestElement') {
		return `...${getParameterName(node.argument, index)}`;
	}

	return `arg${index + 1}`;
}

function isRequireCall(node) {
	return node.callee.type === 'Identifier'
		&& node.callee.name === 'require'
		&& node.arguments.length === 1
		&& node.arguments[0].type === 'StringLiteral';
}

function safeId(value) {
	return value.replace(/[^a-zA-Z0-9_]/g, '_');
}

module.exports = {
	scanWorkspace,
};