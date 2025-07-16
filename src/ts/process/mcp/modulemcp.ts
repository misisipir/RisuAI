//Although these are TECHNICALLY not MCPs, but for the users, we will stick to that name

import type {MCPTool, RPCToolCallContent} from "./mcplib";
import {runScripted} from "../scriptings";
import {MCPClientLike} from "./internalmcp";

//template for MCPClient-like classes that can be used in the MCP system
//Original MCPClient is located in src/ts/process/mcp/mcplib.ts
export class ModuleMCP extends MCPClientLike {

    commonCode: string
    codeType: 'lua' | 'py'
    tools: {
        [key: string]: (MCPTool & {
            functionName: string
            code: string
        })
    }

    constructor(url: string, args: {
        name: string
        version: string
        instructions: string
        codeType: 'lua' | 'py'
        commonCode?: string
        disabledTools?: {[key: string]: boolean}
        tools: {
            [key: string]: (MCPTool & {
                functionName: string
                code: string
            })
        }
    }) {
        super(url);
        const {name, version, instructions, tools} = args;
        this.tools = tools || {};
        this.disabledTools = args.disabledTools || {};
        this.codeType = args.codeType || 'lua';
        this.commonCode = args.commonCode || '';
        this.serverInfo.serverInfo.name = name;
        this.serverInfo.serverInfo.version = version;
        this.serverInfo.instructions = instructions || `Module ${name} v${version} is ready to use.`;
    }

    async checkHandshake() {
        return this.serverInfo;
    }

    async getToolList(): Promise<MCPTool[]> {
        if (!this.tools) return [];
        return Object.keys(this.tools).map((key) => this.tools[key] as MCPTool);
    }

    isDisableTools(tool: string) {
        if (!this.disabledTools || this.disabledTools[tool] === undefined) return true;
        return this.disabledTools[tool];
    }

    async callTool(toolName: string, args: any): Promise<RPCToolCallContent[]> {
        if (!this.tools || !this.tools[toolName])
            return [{
                type: 'text',
                text: `Tool ${toolName} not implemented`
            }];

        const data = await runScripted(
            `${this.commonCode}

${this.tools[toolName].code}`,
            {
                lowLevelAccess: false,
                args: [JSON.stringify(args)],
                mode: this.tools[toolName].functionName,
                type: this.codeType
            }
        );
        return [{
            text: JSON.stringify(data.res),
            type: 'text',
        }]
    }
}
