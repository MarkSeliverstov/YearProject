import * as vscode from 'vscode';

import { IAnnotation, AnnotationModel, SourceFileAnnotations} from "../model";
import { AnnotationReaderConfiguration, AnnotationMarkersConfiguration } from "../configuration";


export class AnnotationReader{
    private readonly parserConfiguration: AnnotationReaderConfiguration;
    private readonly annotationConfiguration: AnnotationMarkersConfiguration;

    private delimiter = "";
    private blockCommentStart = "";
    private blockCommentEnd = "";
    private supportedLanguage = true;
    private isPlainText = false;
    private prefixRegexExpression = "";
    private singleLineSupport = false;
    private multiLineSupport = false;
    
    constructor(parserConfig: AnnotationReaderConfiguration, annotationConfig: AnnotationMarkersConfiguration){
        this.parserConfiguration = parserConfig;
        this.annotationConfiguration = annotationConfig;
    }

    public async parseWorkspace(
        progress: vscode.Progress<{ message?: string; increment?: number }>, 
        token: vscode.CancellationToken
    ): Promise<AnnotationModel>{
        // TODO: Getting external model if exists
        // Getting all project files without external model (eimodel.json)
        const files = await vscode.workspace.findFiles("*");
        console.info("Number of files found: " + files.length);

        const result: SourceFileAnnotations[] = [];
        const interval = setInterval(() => progress.report({ message: progressUpdate, increment: 1/files.length}), 10);
        let progressUpdate = "Starting up...";
        
        for (const file of files) {
            progressUpdate = file.path;
            if (token.isCancellationRequested){
                return {
                    filesAnnotations: result
                };
            }
            clearInterval(interval);
            const annotationsFromFile = await this.readAnnotationsFromFile(file);
            if (annotationsFromFile){
                result.push(annotationsFromFile);
            }
        }
        
        console.log("=== Parsing done! ===");
        return {
            filesAnnotations: result
        };
    }

    /**
     * Finds all single line comments defined by a given annotation values
     * @param activeEditor The active text editor containing the code document
     */
    public async readAnnotationsFromFile(sourceFile: vscode.Uri): Promise<SourceFileAnnotations | null> {
        const fileName = sourceFile.path.split("/").pop();
        if (fileName === undefined) {return null;}
        const fileExtension = fileName.split(".").pop();
        
        if (fileExtension !== undefined){
            this.setRegex(`.${fileExtension}`);
        }
        else {return null;}

        const text = (await vscode.workspace.fs.readFile(sourceFile)).toString();

        // if it's plain text, we have to do mutliline regex to catch the start of the line with ^
        const regexFlags = (this.isPlainText) ? "igm" : "ig";
        const regEx = new RegExp(this.prefixRegexExpression, regexFlags);

        let match;
        const annotations : IAnnotation[] = [];
        while ((match = regEx.exec(text.toString()))) {
            const annotationString = match[2].trim();
            console.log(`Found annotation: ${annotationString}`);
            const annotationName = annotationString.split(" ")[0];
            const annotationValue = (annotationName === annotationString) ? 
                                    null : annotationString.split(" ")[1];
            annotations.push({
                name: annotationName,
                value: annotationValue,
                startPos: match.index,
                endPos: match.index + match[0].length,
                lineNumber: lineNumberByIndex(match.index, text)
            });
        }

        return {
            relativeFilePath: sourceFile.path,
            annotations: annotations
        };
    }

    private isValidPrefixAnnotationNameInline(line:string): boolean{
        return line.match(this.prefixRegexExpression) !== null;
    }
    
    /**
     * Sets the regex to be used by the matcher
     */
    public async setRegex(languageExtension: string) {
        await this.setDelimiter(languageExtension);

        // if the language isn't supported, we don't need to go any further
        if (!this.supportedLanguage) {
            return;
        }

        if (this.isPlainText) {
            // start by tying the regex to the first character in a line
            this.prefixRegexExpression = "^[ \t]*";
        } else {
            // start by finding the delimiter (//, --, #, ') with optional spaces or tabs
            this.prefixRegexExpression = `(${this.delimiter})+[ \t]+`;
        }
        
        // Apply all configurable comment start tags
        const prefixName = this.annotationConfiguration.prefixName;
        this.prefixRegexExpression += `${prefixName}+(.*)`;
    }

    private async setDelimiter(languageExtension: string): Promise<void> {
        this.supportedLanguage = false;
        this.isPlainText = false;
        if ([".txt", ".md"].includes(languageExtension)){
            this.isPlainText = true;
        }

        const config = await this.parserConfiguration.getCommentConfigurationByExtension(languageExtension);
        if (config) {
            const blockCommentStart = config.blockComment ? config.blockComment[0] : null;
            const blockCommentEnd = config.blockComment ? config.blockComment[1] : null;

            this.setCommentFormat(config.lineComment || blockCommentStart, blockCommentStart, blockCommentEnd);
            this.supportedLanguage = true;
        }
    }

    /**
     * Escapes a given string for use in a regular expression
     */
    private escapeRegExp(input: string): string {
        return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Set up the comment format for single and multiline annotations
     */
    private setCommentFormat(
        singleLine: string | string[] | null,
        start: string | null = null,
        end: string | null = null)
    : void {
        this.delimiter = "";
        this.blockCommentStart = "";
        this.blockCommentEnd = "";

        // If no single line comment delimiter is passed, single line comments are not supported
        if (singleLine) {
            if (typeof singleLine === 'string') {
                this.delimiter = this.escapeRegExp(singleLine).replace(/\//ig, "\\/");
            }
            else if (singleLine.length > 0) {
                // * if multiple delimiters are passed, the language has more than one single line comment format
                const delimiters = singleLine
                                .map(s => this.escapeRegExp(s))
                                .join("|");
                this.delimiter = delimiters;
            }
            this.singleLineSupport = true;
        }

        if (start && end) {
            this.blockCommentStart = this.escapeRegExp(start);
            this.blockCommentEnd = this.escapeRegExp(end);
            this.multiLineSupport = true;
        }
    }
}
function lineNumberByIndex(index: number, text: string): number {
    throw new Error('Function not implemented.');
}
