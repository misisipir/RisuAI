<script>
    import {createEventDispatcher, onMount} from 'svelte';
    import CodeMirror from 'codemirror';
    import 'codemirror/lib/codemirror.css';
    import 'codemirror/addon/fold/foldgutter.css';
    import 'codemirror/mode/lua/lua.js';
    import 'codemirror/mode/python/python.js';
    import 'codemirror/mode/markdown/markdown.js';
    import 'codemirror/addon/fold/foldcode.js'
    import 'codemirror/addon/fold/foldgutter.js'
    import 'codemirror/addon/fold/brace-fold.js';
    import 'codemirror/addon/fold/indent-fold.js';

    /** @type {{value: any, mode?: 'lua' | 'python' | 'markdown'}} */
    let {value = $bindable(), mode} = $props();

    const dispatch = createEventDispatcher();
    let velement = $state(), veditor = $state();
    let _value = $state(value);
    let _mode = $state(mode);

    onMount(async () => {
        veditor = initEditor(velement, value, mode);
        veditor.on('change', (_, evt) => {
            if (evt.origin != 'setValue') {
                const input = veditor.getValue('\r\n');
                if (input != value) {
                    value = _value = input;
                    dispatch('change', {translate: false, value: input});
                }
            }
        });
    });

    $effect.pre(() => {
        if (value != _value) {
            veditor.setValue(_value = value);
        }
    });

    $effect.pre(() => {
        if (mode != _mode && veditor) {
            _mode = mode;
            veditor.setOption('mode', mode);
        }
    });

    function initEditor(element, value, mode = 'markdown') {
        return CodeMirror(element, {
            lineNumbers: true,
            value: value,
            mode: mode,
            extraKeys: {"Ctrl-Q": function(cm){ cm.foldCode(cm.getCursor()); }},
            foldGutter: true,
            gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"]
        });
    }

    function updateMarks(doc) {
        const text = doc.getValue();
        for (const mark of doc.getAllMarks()) {
            mark.clear();
        }
        for (const markdown of markdowns) {
            for (const match of text.matchAll(markdown.regex)) {
                const start = doc.posFromIndex(match.index);
                const end = doc.posFromIndex(match.index + match[0].length);
                doc.markText(start, end, {className: markdown.className});
            }
        }
    }
</script>

<div class="flex flex-1 items-end ml-2 mr-2">
    <div class="flex-1 max-h-[500px] overflow-y-auto">
        <div class="chatEditor" bind:this={velement}></div>
    </div>
</div>
<style>
    .chatEditor {
        display: table;
        table-layout: fixed;
        width: 100%;
    }

    .chatEditor :global(.CodeMirror) {
        min-height: 2em;
        height: auto;
        background-color: var(--risu-theme-bgcolor);
        color: var(--risu-theme-textcolor2);
    }

    .chatEditor :global(.cm-number) {
        color: var(--FontColorQuote1);
    }
    .chatEditor :global(.cm-variable) {
        color: var(--risu-theme-textcolor);
    }
    .chatEditor :global(.cm-comment) {
        color: var(--risu-theme-selected);
    }
    .chatEditor :global(.cm-keyword) {
        color: var(--risu-theme-draculared);
    }
    .chatEditor :global(.cm-builtin) {
        color: var(--risu-theme-borderc);
    }
    .chatEditor :global(.CodeMirror-cursor) {
        border-left: solid thin var(--risu-theme-textcolor);
    }

</style>