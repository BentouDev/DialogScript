'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_languageserver_1 = require("vscode-languageserver");
// Create a connection for the server. The connection uses Node's IPC as a transport
let connection = vscode_languageserver_1.createConnection(new vscode_languageserver_1.IPCMessageReader(process), new vscode_languageserver_1.IPCMessageWriter(process));
// Create a simple text document manager. The text document manager
// supports full document sync only
let documents = new vscode_languageserver_1.TextDocuments();
// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);
// After the server has started the client sends an initilize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilites. 
let workspaceRoot;
connection.onInitialize((params) => {
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
    };
});
// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
    validateTextDocument(change.document);
});
// hold the maxNumberOfProblems setting
let maxNumberOfProblems;
// The settings have changed. Is send on server activation
// as well.
connection.onDidChangeConfiguration((change) => {
    let settings = change.settings;
    maxNumberOfProblems = settings.lspSample.maxNumberOfProblems || 100;
    // Revalidate any open text documents
    documents.all().forEach(validateTextDocument);
});
class token {
    constructor(ctx) {
        this.name = ctx.line;
        this.index = ctx.charIndex;
        this.line = ctx.lineIndex;
    }
}
class context {
}
let diagnostics = [];
let actors = new Array();
let funcs = new Array();
let states = new Array();
let gotos = new Array();
let invokes = new Array();
var start;
var arrays = {};
function fullfilReference(ref, defs) {
    let token = ref.name.split('\"')[0].trim();
    let result = defs.find(d => {
        return d.name === token;
    });
    if (!result) {
        diagnostics.push({
            severity: vscode_languageserver_1.DiagnosticSeverity.Error,
            range: {
                start: { line: ref.line, character: ref.index + 1 },
                end: { line: ref.line, character: ref.index + 1 + ref.name.length }
            },
            message: `${ref.name} is undefined`,
            source: 'ex'
        });
        return false;
    }
    return true;
}
;
function fullfilReferences(refs, defs) {
    refs.forEach(ref => {
        fullfilReference(ref, defs);
    });
}
;
function defaultParse(ctx) {
    let array = arrays[ctx.token];
    if (array) {
        let tkn = new token(ctx);
        if (array.indexOf(tkn) < 0) {
            array.push(tkn);
            return true;
        }
        diagnostics.push({
            severity: vscode_languageserver_1.DiagnosticSeverity.Error,
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
function dummyParse(_) {
    return true;
}
function parseStart(ctx) {
    var success;
    if (start === "") {
        start = ctx.line;
        success = true;
    }
    else {
        diagnostics.push({
            severity: vscode_languageserver_1.DiagnosticSeverity.Error,
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
function parseSay(ctx) {
    let textBegin = ctx.line.indexOf('\"');
    let textEnd = ctx.line.lastIndexOf('\"');
    var success = true;
    if (textBegin < 0 || textEnd < 0 || textBegin == textEnd) {
        diagnostics.push({
            severity: vscode_languageserver_1.DiagnosticSeverity.Error,
            range: {
                start: { line: ctx.lineIndex, character: 0 },
                end: { line: ctx.lineIndex, character: ctx.charIndex + ctx.line.length }
            },
            message: `missing text`,
            source: 'ex'
        });
        success = false;
    }
    let actor = ctx.line.substr(0, textBegin).trim();
    let tkn = new token(ctx);
    tkn.name = actor;
    if (!fullfilReference(tkn, actors))
        success = false;
    return success;
}
function parseToken(line) {
    let index = line.indexOf(' ');
    if (index < 0)
        return { token: line, args: "", index: 0 };
    let token = line.substr(0, index).trim();
    let args = line.substr(index).trim();
    return { token: token, args: args, index: index };
}
let keywords = {};
keywords["actor"] = defaultParse;
keywords["function"] = defaultParse;
keywords["topic"] = defaultParse;
keywords["menu"] = defaultParse;
keywords["goto"] = defaultParse;
keywords["invoke"] = defaultParse;
keywords["start"] = parseStart;
keywords["say"] = parseSay;
keywords["exit"] = dummyParse;
function validateTextDocument(textDocument) {
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
    let ctx = new context();
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
        if (parser) {
            if (!parser(ctx))
                problems++;
        }
        else {
            problems++;
            diagnostics.push({
                severity: vscode_languageserver_1.DiagnosticSeverity.Error,
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
connection.onCompletion((_textDocumentPosition) => {
    // The pass parameter contains the position of the text document in 
    // which code complete got requested. For the example we ignore this
    // info and always provide the same completion items.
    return [
        {
            label: 'TypeScript',
            kind: vscode_languageserver_1.CompletionItemKind.Text,
            data: 1
        },
        {
            label: 'JavaScript',
            kind: vscode_languageserver_1.CompletionItemKind.Text,
            data: 2
        }
    ];
});
// This handler resolve additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item) => {
    if (item.data === 1) {
        item.detail = 'TypeScript details',
            item.documentation = 'TypeScript documentation';
    }
    else if (item.data === 2) {
        item.detail = 'JavaScript details',
            item.documentation = 'JavaScript documentation';
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
//# sourceMappingURL=server.js.map