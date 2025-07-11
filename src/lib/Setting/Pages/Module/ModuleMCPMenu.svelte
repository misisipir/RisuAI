<script lang="ts">
    import {language} from "src/lang";
    import TextInput from "src/lib/UI/GUI/TextInput.svelte";
    import type {loreBook} from "src/ts/storage/database.svelte";
    import LoreBookList from "src/lib/SideBars/LoreBook/LoreBookList.svelte";
    import {type CCLorebook, convertExternalLorebook} from "src/ts/process/lorebook.svelte";
    import type {RisuModule} from "src/ts/process/modules";
    import {downloadFile} from "src/ts/globalApi.svelte";
    import {alertError, alertNormal} from "src/ts/alert";
    import {selectMultipleFile} from "src/ts/util";
    import {JSONEditor} from 'svelte-jsoneditor'
    import {v4} from "uuid";
    import {MCPClient, type MCPTool} from "src/ts/process/mcp/mcplib";
    import CheckInput from "src/lib/UI/GUI/CheckInput.svelte";
    import {FileSystemClient} from "src/ts/process/mcp/filesystemclient";
    import {RisuAccessClient} from "src/ts/process/mcp/risuaccess";
    import {AIAccessClient} from "src/ts/process/mcp/aiaccess";
    import {GoogleSearchClient} from "src/ts/process/mcp/googlesearchclient";
    import {MCPClientLike} from "src/ts/process/mcp/internalmcp";
    import {DownloadIcon, FolderPlusIcon, HardDriveUploadIcon, PlusIcon, TrashIcon} from "lucide-svelte";
    import AdvancedChatEditor from "src/lib/ChatScreens/AdvancedChatEditor.svelte";
    import OptionInput from "src/lib/UI/GUI/OptionInput.svelte";
    import SelectInput from "src/lib/UI/GUI/SelectInput.svelte";
    import Arcodion from "src/lib/UI/Arcodion.svelte";
    import {exportRegex, importRegex} from "src/ts/process/scripts";
    import TextAreaInput from "src/lib/UI/GUI/TextAreaInput.svelte";
    import RegexList from "src/lib/SideBars/Scripts/RegexList.svelte";
    import TriggerList from "src/lib/SideBars/Scripts/TriggerList.svelte";
    import Help from "src/lib/Others/Help.svelte";
    import AdvancedCodeEditor from "src/lib/ChatScreens/AdvancedCodeEditor.svelte";

    let submenu = $state(0)
    let mcpTools = $state<MCPTool[]>([])

    interface Props {
        currentModule: RisuModule;
    }

    let {currentModule = $bindable()}: Props = $props();

    function isModuleMcp(): boolean {
        return currentModule.mcp.url.startsWith('module:')
    }

    function addLorebook() {
        if (Array.isArray(currentModule.lorebook)) {
            currentModule.lorebook.push({
                key: '',
                comment: `New Lore`,
                content: '',
                mode: 'normal',
                insertorder: 100,
                alwaysActive: false,
                secondkey: "",
                selective: false
            })
            currentModule.lorebook = currentModule.lorebook
        }
    }

    function addTool() {
        if (Array.isArray(currentModule.mcp.tools) && isModuleMcp()) {
            if (!currentModule.mcp.tools) currentModule.mcp.tools = []
            currentModule.mcp.tools.push({
                annotations: [],
                inputSchema: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
                name: `Tool Name #${currentModule.mcp.tools.length + 1}`,
                description: '',
                functionName: '',
                code: '',
            })
            currentModule.mcp.tools = currentModule.mcp.tools
        }
    }

    function deleteTool(index) {
        if (Array.isArray(currentModule.mcp.tools) && isModuleMcp()) {
            currentModule.mcp.tools.splice(index, 1)
            currentModule.mcp.tools = currentModule.mcp.tools
        }
    }

    function addLorebookFolder() {
        if (Array.isArray(currentModule.lorebook)) {
            const id = v4()
            currentModule.lorebook.push({
                key: '\uf000folder:' + id,
                comment: `New Folder`,
                content: '',
                mode: 'folder',
                insertorder: 100,
                alwaysActive: false,
                secondkey: "",
                selective: false,
            })

            currentModule.lorebook = currentModule.lorebook
        }
    }

    async function exportLoreBook() {
        try {
            const lore = currentModule.lorebook
            const stringl = Buffer.from(JSON.stringify({
                type: 'risu',
                ver: 1,
                data: lore
            }), 'utf-8')

            await downloadFile(`lorebook_export.json`, stringl)

            alertNormal(language.successExport)
        } catch (error) {
            alertError(`${error}`)
        }
    }

    async function importLoreBook() {
        let lore = currentModule.lorebook
        const lorebook = (await selectMultipleFile(['json', 'lorebook']))
        if (!lorebook) {
            return
        }
        try {
            for (const f of lorebook) {
                const importedlore = JSON.parse(Buffer.from(f.data).toString('utf-8'))
                if (importedlore.type === 'risu' && importedlore.data) {
                    const datas: loreBook[] = importedlore.data
                    for (const data of datas) {
                        lore.push(data)
                    }
                } else if (importedlore.entries) {
                    const entries: { [key: string]: CCLorebook } = importedlore.entries
                    lore.push(...convertExternalLorebook(entries))
                }
            }
        } catch (error) {
            alertError(`${error}`)
        }
    }

    function addRegex() {
        if (Array.isArray(currentModule.regex)) {
            currentModule.regex.push({
                comment: "",
                in: "",
                out: "",
                type: "editinput"
            })

            currentModule.regex = currentModule.regex
        }
    }

    function addTrigger() {
        if (Array.isArray(currentModule.trigger)) {
            currentModule.trigger.push({
                conditions: [],
                type: 'start',
                comment: '',
                effect: []
            })

            currentModule.trigger = currentModule.trigger
        }
    }

    $effect.pre(() => {
        fetchTools()
    })

    function validateJson(jsonString: string): boolean {
        try {
            JSON.parse(jsonString);
            return true;
        } catch (e) {
            return false;
        }
    }

    function fetchTools() {
        let mcp: MCPClientLike;
        if (currentModule.mcp.url.startsWith('internal')) {

            switch (currentModule.mcp.url) {
                case 'internal:fs': {
                    mcp = new FileSystemClient();
                    break;
                }
                case 'internal:risuai': {
                    mcp = new RisuAccessClient();
                    break;
                }
                case 'internal:aiaccess': {
                    mcp = new AIAccessClient();
                    break;
                }
                case 'internal:googlesearch': {
                    mcp = new GoogleSearchClient();
                    break;
                }
            }
        } else if (currentModule.mcp.url.startsWith('module:')) {
            if (!currentModule.trigger) currentModule.trigger = []
            if (!currentModule.regex) currentModule.regex = []
            if (!currentModule.mcp.commonCode) currentModule.mcp.commonCode = ''
            if (!currentModule.mcp.tools) currentModule.mcp.tools = []
            if (!currentModule.mcp.disabledTools) currentModule.mcp.disabledTools = {}
            const copy = [];
            for (const tool of currentModule.mcp.tools) {
                copy.push(({...tool}))
                currentModule.mcp.disabledTools[tool.name] ??= true
            }
            mcpTools = copy
            return;
        } else {
            mcp = new MCPClient(currentModule.mcp.url)
        }
        if (!currentModule.mcp.disabledTools) {
            currentModule.mcp.disabledTools = {}
        }
        mcp.getToolList()
            .then(r => {
                const copy = [];
                for (const tool of r) {
                    copy.push(({...tool}))
                    currentModule.mcp.disabledTools[tool.name] ??= true
                }
                mcpTools = copy
            }).finally(() => {
        })
    }
</script>

<div class="flex w-full rounded-md border border-darkborderc mb-4 overflow-x-auto h-16 min-h-16 overflow-y-clip">
    <button onclick={() => {
        submenu = 0
    }} class="p-2 flex-1 border-r border-darkborderc" class:bg-darkbutton={submenu === 0}>
        <span>{language.basicInfo}</span>
    </button>
    <button onclick={() => {
        currentModule.lorebook ??= []
        submenu = 1
    }} class="p2 flex-1 border-r border-darkborderc" class:bg-darkbutton={submenu === 1}>
        <span>{language.loreBook}</span>
    </button>
    <button onclick={() => {
        submenu = 2
    }} class="p-2 flex-1 border-r border-darkborderc" class:bg-darkbutton={submenu === 2}>
        <span>{language.regex}</span>
    </button>
    <button onclick={() => {
        submenu = 3
    }} class="p-2 flex-1 border-r border-darkborderc" class:bg-darkbutton={submenu === 3}>
        <span>{language.trigger}</span>
    </button>
    <button onclick={() => {
        submenu = 4
    }} class="p-2 flex-1 border-r border-darkborderc" class:bg-darkbutton={submenu === 4}>
        <span>Tools</span>
    </button>
</div>

{#if submenu === 0}
    <span>{language.name}</span>
    <TextInput bind:value={currentModule.name} className="mt-1"/>
    <span class="mt-4">{language.description}</span>
    <TextInput bind:value={currentModule.description} className="mt-1" size="sm"/>
    <span class="mt-4">URL</span>
    <TextInput bind:value={currentModule.mcp.url} className="mt-1" size="sm"/>
    <span class="mt-4">{language.customPromptTemplateToggle}
        <Help key='customPromptTemplateToggle'/></span>
    <TextAreaInput bind:value={currentModule.customModuleToggle}/>
{/if}
{#if submenu === 1 && (Array.isArray(currentModule.lorebook))}
    <LoreBookList externalLoreBooks={currentModule.lorebook}/>
    <div class="text-textcolor2 mt-2 flex">
        <button onclick={() => {addLorebook()}} class="hover:text-textcolor cursor-pointer ml-1">
            <PlusIcon/>
        </button>
        <button onclick={() => {exportLoreBook()}} class="hover:text-textcolor cursor-pointer ml-2">
            <DownloadIcon/>
        </button>
        <button onclick={() => {
            addLorebookFolder()
        }} class="hover:text-textcolor ml-2  cursor-pointer">
            <FolderPlusIcon/>
        </button>
        <button onclick={() => {importLoreBook()}} class="hover:text-textcolor cursor-pointer ml-2">
            <HardDriveUploadIcon/>
        </button>
    </div>
{/if}
{#if submenu === 2 && (Array.isArray(currentModule.regex))}
    <TextAreaInput bind:value={currentModule.backgroundEmbedding} className="mt-2" placeholder={language.backgroundHTML}
                   size="sm"/>
    <RegexList bind:value={currentModule.regex}/>
    <div class="text-textcolor2 mt-2 flex gap-2">
        <button class="font-medium cursor-pointer hover:text-green-500" onclick={() => {
            addRegex()
        }}>
            <PlusIcon/>
        </button>
        <button class="font-medium cursor-pointer hover:text-green-500" onclick={() => {
            exportRegex(currentModule.regex)
        }}>
            <DownloadIcon/>
        </button>
        <button class="font-medium cursor-pointer hover:text-green-500" onclick={async () => {
            currentModule.regex = await importRegex(currentModule.regex)
        }}>
            <HardDriveUploadIcon/>
        </button>
    </div>
{/if}
{#if submenu === 3 && (Array.isArray(currentModule.trigger))}
    <div class="flex w-full">
    <div class="max-w-screen-md">
    <TriggerList bind:value={currentModule.trigger} lowLevelAble={currentModule.lowLevelAccess}/>
    </div>

    <div class="flex items-center mt-4">
        <CheckInput bind:check={currentModule.lowLevelAccess} name={language.lowLevelAccess}/>
        <span> <Help key="lowLevelAccess" name={language.lowLevelAccess}/></span>
    </div>
    </div>
{/if}
{#if submenu === 4 && (!isModuleMcp()) && (Array.isArray(mcpTools))}
    {#each mcpTools as tool, i}
        <div class="flex items-center justify-between p-2 border-b gap-4 border-darkborderc">
            <span class="text-textcolor">{tool.name}</span>
            <span class="text-textcolor">{tool.description}</span>
            <CheckInput bind:check={currentModule.mcp.disabledTools[tool.name]}/>
        </div>
    {/each}
{/if}
{#if submenu === 4 && isModuleMcp() && (Array.isArray(currentModule.mcp.tools))}
    <div class="flex flex-col gap-2 w-full">
        <span><span class="pr-4">Tools option</span>
                    <SelectInput bind:value={currentModule.mcp.codeType}>
            <OptionInput value="lua">Lua</OptionInput>
            <OptionInput value="py">Python</OptionInput>
        </SelectInput>
        </span>
        <div class="max-w-screen-md">
            <AdvancedCodeEditor
                    bind:value={currentModule.mcp.commonCode}
                    mode={currentModule.mcp.codeType === 'py'? 'python' : 'lua'}/>

        </div>

        {#each currentModule.mcp.tools as tool, i}
            <Arcodion name={tool.name} styled>
                <div class="grid grid-cols-1 items-center justify-between p-2 border-b gap-4 border-darkborderc">
                    <span>Tool Name</span>
                    <div class="flex gap-4">
                        <TextInput bind:value={tool.name} className="w-full flex-1" placeholder="Tool Name"/>
                        <CheckInput bind:check={currentModule.mcp.disabledTools[tool.name]} className="">
                            Enable Tool
                        </CheckInput>
                        <button onclick={() => {deleteTool(i)}} class="hover:text-textcolor cursor-pointer ml-1">
                            <TrashIcon/>
                        </button>
                    </div>
                    <span>Tool description</span>
                    <TextInput bind:value={tool.description} className="w-full" placeholder="Tool Description"/>
                    <span>Tool functionName</span>
                    <TextInput bind:value={tool.functionName} className="w-full" placeholder="Function Name"/>
                    <span>Tool inputSchema</span>
                    <JSONEditor {...{content: {json: tool.inputSchema}}} onChange={(updatedContent, previousContent, { contentErrors, patchResult })=>{
                if (typeof updatedContent === 'object' && 'json' in updatedContent) {
                    tool.inputSchema = updatedContent.json;
                }
            }}/>
                    <span>Tool code</span>
                    <div class="max-w-screen-md">
                        <AdvancedCodeEditor bind:value={tool.code}
                                            className="max-w-44"
                                            mode={currentModule.mcp.codeType === 'py'? 'python' : 'lua'}/>
                    </div>
                </div>
            </Arcodion>
        {/each}
        <div class="text-textcolor2 mt-2 flex">
            <button onclick={() => {addTool()}} class="hover:text-textcolor cursor-pointer ml-1">
                <PlusIcon/>
            </button>
        </div>
    </div>
{/if}