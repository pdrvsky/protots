import fs from "fs";
import path from "path";
import isPathValid from "is-valid-path";
import prettier from "prettier";
import { promisify } from "util";
import { Readable } from "stream";
import { pascalCase, camelCase } from "change-case";

let syntax = "proto3";
let hasPackage = false;
const writeAsync = promisify(fs.writeFile);

function reset() {
    syntax = "proto3";
    hasPackage = false;
}

type ParsedStruct = {
    toString: () => string;
    toFile: (path: string) => Promise<void>;
};

type ProtobufTypes = {
    double: string;
    float: string;
    int32: string;
    int64: string;
    uint32: string;
    uint64: string;
    sint32: string;
    sint64: string;
    fixed32: string;
    fixed64: string;
    sfixed32: string;
    sfixed64: string;
    bool: string;
    string: string;
    bytes: string;
};

export enum StreamBehaviour {
    Strip = "strip",
    Generic = "generic",
    Native = "native"
}

export interface PrototsOptions {
    keepComments?: boolean;
    streamBehaviour?: StreamBehaviour;
    stripEmtpyLines?: boolean;
    useObservable?: boolean;
    useMetadata?: boolean;
}

async function readFileStream(stream: Readable): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Uint8Array[] = [];
        stream.on("data", chunk => chunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    });
}

async function readFile(file: string | Buffer | Readable): Promise<string> {
    let content = null;
    if (file instanceof Readable) {
        const stream = await readFileStream(file);
        return stream;
    }
    if (typeof file === "string" && isPathValid(file)) return readFile(fs.createReadStream(path.resolve(file)));
    if (file instanceof Buffer) content = file.toString("utf-8");
    if (typeof file === "string") content = file;
    if (!file || !content) return "";

    return content;
}

function getProtoVersion(contents: string): string | null {
    const obtainedSyntax = /(?!syntax = ")(proto[0-9])(?=";)/gim.exec(contents);
    return obtainedSyntax ? (obtainedSyntax.shift() as string) : null;
}

function stripUselessSyntax(contents: string): string {
    return contents.replace(/syntax.*|option .*/gim, "--remove--");
}

function tokenize(line: string): string[] {
    return line
        .trim()
        .split(" ")
        .filter(Boolean);
}

function getRpcType(type: string, isStream: boolean, behaviour: StreamBehaviour) {
    if (!isStream || behaviour === StreamBehaviour.Strip) return type;

    return behaviour === StreamBehaviour.Native ? "Stream" : `Stream<${type}>`;
}

function parseRpcLine(line: string, streamBehaviour: StreamBehaviour, useObservable: boolean, useMetadata: boolean) {
    const rpcRegex = /rpc (?<methodName>[^(]+)\((?<requestStream>stream)? ?(?<requestType>[^)]+)\) ?returns ?\((?<responseStream>stream)? ?(?<responseType>[^)]+)\)/gim;
    const result = rpcRegex.exec(line);

    if (!result || !result.groups) return line;

    const {
        methodName: _methodName,
        requestStream: _requestStream,
        requestType: _requestType,
        responseStream: _responseStream,
        responseType: _responseType
    } = result.groups;

    const methodName = camelCase(_methodName);

    const requestVariableName =
        _requestStream && streamBehaviour !== StreamBehaviour.Strip
            ? `${camelCase(_requestType)}Stream`
            : camelCase(_requestType);

    const requestType = getRpcType(_requestType, Boolean(_requestStream), streamBehaviour);
    const responseType = getRpcType(_responseType, Boolean(_responseStream), streamBehaviour);

    if (!useObservable) {
        return `${methodName} (${requestVariableName}: ${requestType}${
            useMetadata ? ", metadata: any" : ""
        }): ${responseType}`;
    } else {
        return `${methodName} (${requestVariableName}: ${requestType}${
            useMetadata ? ", metadata: any" : ""
        }): Observable<${responseType}>`;
    }
}

function parseMessageServiceTokenizedLine(
    tokens: string[],
    keepComments: boolean,
    streamBehaviour: StreamBehaviour,
    stripEmptyLines: boolean,
    useObservable: boolean,
    useMetadata: boolean
) {
    let output = `export interface ${tokens[1]} {`;
    // message FooMessage { /lf
    if (tokens.length <= 3) {
        return output;
    }

    output += parseLine(
        tokens.slice(3).join(" "),
        keepComments,
        streamBehaviour,
        stripEmptyLines,
        useObservable,
        useMetadata
    );
    output += "}";
    return output;
}

function parseEnumTokenizedLine(
    tokens: string[],
    keepComments: boolean,
    streamBehaviour: StreamBehaviour,
    stripEmptyLines: boolean,
    useObservable: boolean,
    useMetadata: boolean
) {
    let output = `export enum ${tokens[1]} {`;
    // enum FooEnum { /lf
    if (tokens.length <= 3) {
        return output;
    }

    output += parseLine(
        tokens.slice(3).join(" "),
        keepComments,
        streamBehaviour,
        stripEmptyLines,
        useObservable,
        useMetadata
    );
    output += "}";
    return output;
}

function convertToTypescriptTypes(token: keyof ProtobufTypes) {
    const types: ProtobufTypes = {
        double: "number",
        float: "number",
        int32: "number",
        int64: "number",
        uint32: "number",
        uint64: "number",
        sint32: "number",
        sint64: "number",
        fixed32: "number",
        fixed64: "number",
        sfixed32: "number",
        sfixed64: "number",
        bool: "boolean",
        string: "string",
        bytes: "string"
    };

    return types[token];
}

function getLineParser(
    keepComments: boolean,
    streamBehaviour: StreamBehaviour,
    stripEmptyLines: boolean,
    useObservable: boolean,
    useMetadata: boolean
) {
    return (line: string) =>
        parseLine(line, keepComments, streamBehaviour, stripEmptyLines, useObservable, useMetadata);
}

function parseLine(
    line: string,
    keepComments: boolean,
    streamBehaviour: StreamBehaviour,
    stripEmptyLines: boolean,
    useObservable: boolean,
    useMetadata: boolean
): string {
    if (!line) return stripEmptyLines ? "--remove--" : "";

    const tokens = tokenize(line);
    let isRepeated = false;
    let isOptional = syntax === "proto3" ? true : false;

    if (tokens.length === 1 && tokens[0] === "--remove--") {
        return stripEmptyLines ? "--remove--" : "";
    }

    switch (tokens[0]) {
        case "//":
            return keepComments ? line : "--remove--";
        case "}":
            return `}`;
        case "message":
        case "service":
            return parseMessageServiceTokenizedLine(
                tokens,
                keepComments,
                streamBehaviour,
                stripEmptyLines,
                useObservable,
                useMetadata
            );
        case "enum":
            return parseEnumTokenizedLine(
                tokens,
                keepComments,
                streamBehaviour,
                stripEmptyLines,
                useObservable,
                useMetadata
            );
        case "rpc":
            return parseRpcLine(line, streamBehaviour, useObservable, useMetadata);
        case "package":
            hasPackage = true;
            return `export namespace ${pascalCase(tokens[1].replace(";", ""))} {`;
        case "required":
            isOptional = false;
            tokens.shift();
            break;
        case "optional":
            isOptional = true;
            tokens.shift();
            break;
        case "repeated":
            isRepeated = true;
            tokens.shift();
    }

    const typescriptType = convertToTypescriptTypes(tokens[0] as any);
    if (typescriptType || (!typescriptType && tokens[1] !== "=")) {
        return `${camelCase(tokens[1])}${isOptional ? "?" : ""}: ${typescriptType || tokens[0]}${
            isRepeated ? "[]" : ""
        }`;
    } else {
        // Assume it is an enum entry
        return `${tokens[0]},`;
    }
}

async function parse(file: string | Buffer | Readable, options: PrototsOptions = {}): Promise<ParsedStruct> {
    const {
        keepComments = false,
        streamBehaviour = StreamBehaviour.Native,
        stripEmtpyLines = true,
        useObservable = false,
        useMetadata = false
    } = options;

    if (!Object.values(StreamBehaviour).includes(streamBehaviour))
        throw new Error(`"${streamBehaviour}" is not a valid stream behaviour!`);

    if (!file) throw new Error("No file specified");
    const fileContents = await readFile(file);

    syntax = getProtoVersion(fileContents) || syntax;
    const clean = stripUselessSyntax(fileContents);
    const streamImportLine = `import Stream from '${
        streamBehaviour === StreamBehaviour.Native ? "stream" : "ts-stream"
    }'`;

    const lines = clean
        .split("\n")
        .map(getLineParser(keepComments, streamBehaviour, stripEmtpyLines, useObservable, useMetadata))
        .filter(line => !/--remove--/.test(line));

    const result =
        /stream/gim.test(clean) && streamBehaviour !== StreamBehaviour.Strip ? [streamImportLine, "", ...lines] : lines;

    if (hasPackage) result.push("}");
    if (useObservable) result.unshift("import { Observable } from 'rxjs';");

    let parsed = result.join("\n");
    const prettierFilePath = await prettier.resolveConfigFile();
    if (prettierFilePath) {
        const prettierConfig = await prettier.resolveConfig(prettierFilePath);
        parsed = prettier.format(parsed, { ...prettierConfig, parser: "typescript" });
    }

    reset();
    return {
        toString: () => parsed,
        toFile(path: string) {
            return writeAsync(path, parsed);
        }
    };
}

module.exports = parse;
export default parse;
export { parse };
