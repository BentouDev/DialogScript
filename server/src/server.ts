'use strict';

import {
	IPCMessageReader, IPCMessageWriter, createConnection, IConnection, TextDocuments, TextDocument, 
	Diagnostic, DiagnosticSeverity, InitializeResult, TextDocumentPositionParams, CompletionItem, 
	CompletionItemKind
} from 'vscode-languageserver';

// Create a connection for the server. The connection uses Node's IPC as a transport
let connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments();
// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// After the server has started the client sends an initilize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilites. 
let workspaceRoot: string;
connection.onInitialize((params): InitializeResult => {
	workspaceRoot = params.rootPath;
	return {
		capabilities: {
			// Tell the client that the server works in FULL text document sync mode
			textDocumentSync: documents.syncKind,
			// Tell the client that the server support code complete
			completionProvider: {
				resolveProvider: true
			}
		}
	}
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
	validateTextDocument(change.document);
});

// The settings interface describe the server relevant settings part
interface Settings {
	lspSample: ExampleSettings;
}

// These are the example settings we defined in the client's package.json
// file
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// hold the maxNumberOfProblems setting
let maxNumberOfProblems: number;
// The settings have changed. Is send on server activation
// as well.
connection.onDidChangeConfiguration((change) => {
	let settings = <Settings>change.settings;
	maxNumberOfProblems = settings.lspSample.maxNumberOfProblems || 100;
	// Revalidate any open text documents
	documents.all().forEach(validateTextDocument);
});

class token {
	constructor(ctx:context) {
		this.name = ctx.line;
		this.index = ctx.charIndex;
		this.line = ctx.lineIndex;
	}
	
	name : string;
	index : number;
	line : number;
}

class context {
	lineIndex : number;
	charIndex : number;
	line : string;
	token : string;
}

let diagnostics: Diagnostic[] = [];
let actors = new Array<token>();
let funcs  = new Array<token>();
let states = new Array<token>();
let gotos  = new Array<token>();
let invokes = new Array<token>();
var start : string;
var arrays : {[id:string] : Array<token>} = {};

function fullfilReference(ref: token, defs:Array<token>) : boolean {
	let token = ref.name.split('\"')[0].trim();
	let result = defs.find(d => {
		return d.name === token;
	})
	if (!result)
	{
		diagnostics.push({
			severity: DiagnosticSeverity.Error,
			range: {
				start: {line: ref.line, character: ref.index + 1},
				end: {line: ref.line, character: ref.index + 1 + ref.name.length}
			},
			message: `${ref.name} is undefined`,
			source: 'ex'
		})

		return false;
	}

	return true;
};

function fullfilReferences(refs:Array<token>, defs:Array<token>) {
	refs.forEach(ref => {
		fullfilReference(ref, defs);
	})
};

function defaultParse(ctx: context): boolean {
	let array = arrays[ctx.token];
	if (array)
	{
		let tkn = new token(ctx);
		if (array.indexOf(tkn) < 0)
		{
			array.push(tkn);
			return true;
		}
		
		diagnostics.push({
			severity: DiagnosticSeverity.Error,
			range: {
				start: { line: ctx.lineIndex, character: 0 },
				end: { line: ctx.lineIndex, character: ctx.charIndex + ctx.token.length }
			},
			message: `${ctx.token} already exists`,
			source: 'ex'
		});
	}

	return false;
}

function dummyParse(_:context): boolean {
	return true;
}

function parseStart(ctx: context): boolean {
	var success : boolean;
	if (start === "")
	{
		start = ctx.line;
		success = true;
	}
	else
	{
		diagnostics.push({
			severity: DiagnosticSeverity.Error,
			range: {
				start: { line: ctx.lineIndex, character: 0 },
				end: { line: ctx.lineIndex, character: ctx.charIndex + ctx.line.length }
			},
			message: `duplicated start`,
			source: 'ex'
		});
		success = false;
	}

	return success;
}

function parseSay(ctx: context): boolean {
	let textBegin = ctx.line.indexOf('\"');
	let textEnd = ctx.line.lastIndexOf('\"');
	var success : boolean = true;

	if (textBegin < 0 || textEnd < 0 || textBegin == textEnd)
	{
		diagnostics.push({
			severity: DiagnosticSeverity.Error,
			range: {
				start: { line: ctx.lineIndex, character: 0 },
				end: { line: ctx.lineIndex, character: ctx.charIndex + ctx.line.length }
			},
			message: `missing text`,
			source: 'ex'
		})
		success = false;
	}

	let actor = ctx.line.substr(0, textBegin).trim();
	let tkn = new token(ctx);
	tkn.name = actor;

	if (!fullfilReference(tkn, actors))
		success = false;

	return success;
}

function parseToken(line: string): {token:string, args:string, index:number} {
	let index = line.indexOf(' ');
	if (index < 0)
		return {token:line, args:"", index:0}

	let token = line.substr(0, index).trim();
	let args  = line.substr(index).trim();
	return {token:token, args:args, index:index};
}

let keywords : {[id:string] : (ctx:context) => boolean } = {};
keywords["actor"] = defaultParse;
keywords["function"] = defaultParse;
keywords["topic"] = defaultParse;
keywords["menu"] = defaultParse;
keywords["goto"] = defaultParse;
keywords["invoke"] = defaultParse;
keywords["start"] = parseStart;
keywords["say"] = parseSay;
keywords["exit"] = dummyParse;

function validateTextDocument(textDocument: TextDocument): void {
	let lines = textDocument.getText().split(/\r?\n/g);
	let problems = 0;

	diagnostics = [];
	actors = [];
	states = [];
	funcs = [];
	gotos = [];
	invokes = [];
	start = "";

	arrays["actor"] = actors;
	arrays["function"] = funcs;
	arrays["topic"] = states;
	arrays["menu"] = states;
	arrays["goto"] = gotos;
	arrays["invoke"] = invokes;
	
	let ctx : context =  new context();

	for (var i = 0; i < lines.length && problems < maxNumberOfProblems; i++) {
		let line = lines[i];
		ctx.lineIndex = i;
		
		if (!line || line[0] == '#')
			continue;

		let cmd = parseToken(line);
		let parser = keywords[cmd.token];

		ctx.token = cmd.token;
		ctx.line = cmd.args;
		ctx.charIndex = cmd.index;

		if (parser) 
		{
			if (!parser(ctx))
				problems++;
		}
		else
		{
			problems++;
			diagnostics.push({
				severity: DiagnosticSeverity.Error,
				range: {
					start: { line: i, character: 0 },
					end: { line: i, character: cmd.token.length }
				},
				message: `unknown token ${cmd.token}`,
				source: 'ex'
			});
		}
	}

	fullfilReferences(invokes, funcs);
	fullfilReferences(gotos, states);

	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles((_change) => {
	// Monitored files have change in VSCode
	connection.console.log('We recevied an file change event');
});


// This handler provides the initial list of the completion items.
connection.onCompletion((_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
	// The pass parameter contains the position of the text document in 
	// which code complete got requested. For the example we ignore this
	// info and always provide the same completion items.
	return [
		{
			label: 'TypeScript',
			kind: CompletionItemKind.Text,
			data: 1
		},
		{
			label: 'JavaScript',
			kind: CompletionItemKind.Text,
			data: 2
		}
	]
});

// This handler resolve additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
	if (item.data === 1) {
		item.detail = 'TypeScript details',
			item.documentation = 'TypeScript documentation'
	} else if (item.data === 2) {
		item.detail = 'JavaScript details',
			item.documentation = 'JavaScript documentation'
	}
	return item;
});

/*
connection.onDidOpenTextDocument((params) => {
	// A text document got opened in VSCode.
	// params.uri uniquely identifies the document. For documents store on disk this is a file URI.
	// params.text the initial full content of the document.
	connection.console.log(`${params.textDocument.uri} opened.`);
});
connection.onDidChangeTextDocument((params) => {
	// The content of a text document did change in VSCode.
	// params.uri uniquely identifies the document.
	// params.contentChanges describe the content changes to the document.
	connection.console.log(`${params.textDocument.uri} changed: ${JSON.stringify(params.contentChanges)}`);
});
connection.onDidCloseTextDocument((params) => {
	// A text document got closed in VSCode.
	// params.uri uniquely identifies the document.
	connection.console.log(`${params.textDocument.uri} closed.`);
});
*/

// Listen on the connection
connection.listen();
