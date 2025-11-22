// emulator/emulator.js //test edit

import {
    state,
    storyCards,
    history,
    addStoryCard,
    removeStoryCard,
    updateStoryCard,
    //log
} from "./Parameters.js";

import {
    runInputModifier,
    runContextModifier,
    runOutputModifier,
} from "./Loader.js";

/* ==================================================================================
   Design overview (short)
   ----------------------------------------------------------------------------------
   - Emulator is a state machine: currentSide === "user" | "ai"
   - UI calls handleInput(selectedMode, text) when the user clicks Enter (or presses Enter)
   - handleInput delegates to processUserTurn or processAITurn depending on currentSide
   - Hooks (inputModifier, contextModifier, outputModifier) are loaded from sandbox
   - Renderer methods update DOM but do not contain logic for "what happens next"
   - All mutations to history/context/memory happen inside Emulator (single source of truth)
   ================================================================================== */

class Emulator {
    constructor(opts = {}) {
        // State managed here uses your imported `state` and `history`.
        // Keep emulator-specific transient state local:
        this.currentSide = "user"; // "user" or "ai"
        this.selectedMode = "say"; // default selected input mode
        this.dom = {}; // will hold DOM references after wiring

        // Optional logger function from parameters.js or opts
        this.log = typeof log === "function" ? log : (msg) => console.log(msg);
        this.logFile = "emulatorLog.txt";

        // Kick off async initialization
        this._initPromise = this.init(); // allows callers to await if needed
    }

    /* -------------------------
         Async initialization:
         - load sandbox hooks
         - wire UI elements and listeners
         - render initial state
         ------------------------- */
    async init() {
        // 1) Wire DOM elements
        this.wireDOM();

        // 2) Initial render
        this.renderer_log("Dungeon AI Simulator initialized.");
        this.renderer_updateMainView(); // show initial content
        history.push({ mode: "start", text: "=== New Session Started ===" });
    }




    async handleInput(mode, text) {
        var newText;
        var context;
        // Wait for initialization if it's still in progress
        if (this._initPromise) await this._initPromise;

        // Basic validation
        if (typeof text !== "string") text = String(text || "");
        mode = mode || this.selectedMode || "say"; // fallback to selected mode

        // Ignore empty input (but you may want special handling elsewhere)
        if (!text.trim()) {
            this.renderer_log("(Ignored empty input)");
            return;
        }

        // Dispatch based on who is active
        if (this.currentSide === "user") {
            newText = await this.processInput(mode, text);              
            history.push({mode: "", text: newText});
            context = await this.processContext();
            this.currentSide = "ai";
        } else {
            newText = await this.processOutput(text);            
            history.push({mode: "", text: newText});
            this.currentSide = "user";
        }



        // Update UI to reflect changes
        this.renderer_updateMainView(context);
    }


    async processInput(mode, rawText) {
        try {
            this.renderer_log(`Processing user input (mode=${mode})...`);

            // 1) Hook: inputModifier
            const modified = await this.safeCallHook("inputModifier", rawText);
            return modified
        } catch (err) {
            this.renderer_log("Error processing user turn: " + err.message);
            console.error(err);
        }
    }

    async processOutput(rawText) {
        try {
            this.renderer_log(`Processing AI output...`);
            const modified = await this.safeCallHook("outputModifier", rawText);
            this.renderer_log(`AI -> ${modified}`);
            return modified;
        } catch (err) {
            this.renderer_log("Error processing AI turn: " + err.message);
            console.error(err);
        }
    }

    async processContext() {
        // Rebuild raw context from history lines
        const rawContext = history.map(h => `${h.text}`).join("\n");
        state.memory.frontMemory = "";

        // Apply contextModifier hook to produce the AI-facing context
        const aiContext = await this.safeCallHook("contextModifier", rawContext);

        // Also update any other memory fields if needed — keep single source of truth here
        this.renderer_log("Context rebuilt and transformed.");
        //this.renderer_log(aiContext);


        return aiContext;
    }

    /* -------------------------
         safeCallHook(name, arg)
         Utility to call a hook safely (try/catch + identity fallback)
         ------------------------- */
    async safeCallHook(name, arg) {
        try {
            const globals = this.getHookGlobals(arg);
            let result;

            switch (name) {
                case "inputModifier":
                    result = await runInputModifier(globals);
                    break;
                case "contextModifier":
                    result = await runContextModifier(globals);
                    break;
                case "outputModifier":
                    result = await runOutputModifier(globals);
                    break;
                default:
                    return arg;
            }

            // Modifier MUST return { text }
            if (result && typeof result.text === "string") {
                return result.text;
            }

            this.renderer_log(`Hook ${name} returned invalid shape:`, result);
            return arg;

        } catch (err) {
            this.renderer_log(`Hook ${name} threw: ${err}`);
            return arg;
        }
    }



    getHookGlobals(arg) 
    {
        return {
            state,
            text: arg,
            history,
            storyCards,
            addStoryCard,
            removeStoryCard,
            updateStoryCard
        };
    }

    /* =================================================================================
         UI: wiring + renderer methods
         - The emulator should NOT manipulate layout or global CSS. It only updates content
           inside DOM elements and manages small UI state like which mode button is active.
         - These functions assume the HTML structure provided to you earlier:
             - top mode buttons under #inputModeButtons
             - input field with #emulatorInput
             - enter button with #emulatorEnter
             - main text window #mainTextWindow
             - console area #emulatorConsole
         ================================================================================= */



    // -----------------------------
    // Attach DOM references and event listeners
    // 1. Querying + validating DOM
    // -----------------------------

    wireDOM() {
        this.bindMainElements();
        this.bindModeButtons();
        this.bindEnterHandlers();
        this.bindTabs();
    }


    bindMainElements() {
        this.dom.mainTextWindow = document.getElementById("mainScreen");
        this.dom.emulatorConsole = document.getElementById("emulatorConsole");
        this.dom.inputField = document.getElementById("emulatorInput");
        this.dom.enterBtn = document.getElementById("emulatorSubmit");
        this.dom.modeButtons = Array.from(
            document.querySelectorAll("#modeButtons button")
        );
        this.dom.tabButtons = Array.from(
            document.querySelectorAll("#topTabs .tab")
        );

        // In case you add real tab panels later:
        this.dom.tabPanels = [];

        if (
            !this.dom.mainTextWindow ||
            !this.dom.emulatorConsole ||
            !this.dom.inputField ||
            !this.dom.enterBtn
        ) {
            console.warn(
                "Emulator: some DOM elements not found. Make sure the HTML matches expected IDs."
            );
        }
    }



    // -----------------------------
    // 2. Mode buttons
    // -----------------------------
    bindModeButtons() {
        if (!this.dom.modeButtons?.length) return;

        // Initialize from DOM-selected button if exists
        const activeBtn = this.dom.modeButtons.find((b) =>
            b.classList.contains("active")
        );

        if (activeBtn)
            this.selectedMode = activeBtn.dataset.mode || this.selectedMode;

        this.dom.modeButtons.forEach((btn) => {
            btn.addEventListener("click", () => {
                this.setSelectedMode(btn.dataset.mode);
            });
        });
    }



    // -----------------------------
    // 3. Input handling (Enter button + Enter key)
    // -----------------------------
    bindEnterHandlers() {
        if (!this.dom.enterBtn) return;

        // Click submit
        this.dom.enterBtn.addEventListener("click", () => {
            const txt = this.dom.inputField?.value || "";
            if (this.dom.inputField) this.dom.inputField.value = "";
            this.handleInput(this.selectedMode, txt);
        });

        // Press Enter inside input
        if (this.dom.inputField) {
            this.dom.inputField.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    const txt = this.dom.inputField.value;
                    this.dom.inputField.value = "";
                    this.handleInput(this.selectedMode, txt);
                }
            });
        }
    }



    // -----------------------------
    // 4. Tabs
    // -----------------------------
    bindTabs() {
        if (!this.dom.tabButtons?.length) return;

        this.dom.tabButtons.forEach((tab) => {
            tab.addEventListener("click", () => {
                this.switchTab(tab.dataset.tab);
            });
        });
    }

    // -----------------------------
    // DOM wiring done
    // -----------------------------






    /* -------------------------
         setSelectedMode(mode)
         - updates internal selectedMode and toggles active class on buttons
         ------------------------- */
    setSelectedMode(mode) {
        this.selectedMode = mode;
        // toggle active UI state
        if (this.dom.modeButtons) {
            this.dom.modeButtons.forEach((btn) => {
                if (btn.dataset.mode === mode) btn.classList.add("active");
                else btn.classList.remove("active");
            });
        }
        this.renderer_log(`Mode selected: ${mode}`);
    }

    /* -------------------------
         Tab switching: show/hide panels
         Assumes .tabPanel elements exist with id values that match data-tab attributes
         ------------------------- */
    switchTab(tabId) {
        if (!this.dom.tabPanels) return;
        this.dom.tabPanels.forEach((panel) => {
            if (panel.id === tabId) panel.classList.remove("hidden");
            else panel.classList.add("hidden");
        });
        // toggle active on tab buttons
        if (this.dom.tabButtons) {
            this.dom.tabButtons.forEach((btn) => {
                if (btn.dataset.tab === tabId) btn.classList.add("active");
                else btn.classList.remove("active");
            });
        }
        this.renderer_log(`Switched to tab: ${tabId}`);
    }

    /* -------------------------
         renderers: these update DOM content only
         - renderer_updateMainView: rebuilds the left text window (user or ai view)
         - renderer_appendToConsole: appends messages to the console
         - renderer_log: short helper that appends and also calls external log()
         ------------------------- */

    // Rebuild the main left window based on currentSide and the processed context
    renderer_updateMainView(context) 
    {
        if (!this.dom.mainTextWindow) return;

        const view = this.currentSide === "user"
            ? this.buildUserView()
            : this.buildAIView(context);

        this.dom.mainTextWindow.innerHTML = view;

        // Side effects remain here
        this.renderer_updateConsoleSnapshot();
        this.renderer_scrollConsoleToBottom();
    }

    buildUserView() 
    {
        const maxEntries = 100;
        const recent = history.map(h => `${h.text}`).slice(-maxEntries);
        const userViewHtml = recent
            .map((line) => this.escapeHtml(line))
            .join("<br>");

        return `
            <b>User View (last ${maxEntries}):</b><br>
            ${userViewHtml}
        `;
    }

    buildAIView(context) 
    {
        if (!context) return "";

        const frontMem = this.escapeHtml(state.memory.frontMemory || "");

        return `
            <b>=== AI Context View ===</b><br>
            ${context.replace(/\n/g, "<br>")}
        `;
    }


    // Update console "snapshot" (for convenience show last few console messages)
    renderer_updateConsoleSnapshot() {
        if (!this.dom.emulatorConsole) return;
        // Keep console display in sync with a subset of history or your own console buffer
        // Here we prefer to show an internal console buffer (not history) so we include renderer logs
        // But if you want history-based console, you can display that instead.
        // For simplicity, do nothing here; console is updated via renderer_log and append.
    }

    // Append a plain-text message to console DOM
    renderer_appendToConsole(msg) {
        if (!this.dom.emulatorConsole) {
            // fallback to console.log if DOM not available
            console.log(msg);
            return;
        }
        const sanitized = this.escapeHtml(msg);
        this.dom.emulatorConsole.innerHTML += sanitized + "<br>";
        // Keep the console scrolled to bottom
        this.dom.emulatorConsole.scrollTop =
            this.dom.emulatorConsole.scrollHeight;
    }

    // Generic logger used internally; also calls external log() if available.
    renderer_log(msg) {
        const timestamp = new Date().toLocaleTimeString();
        const entry = `[${timestamp}] ${msg}`;
        // Append to console UI
        this.renderer_appendToConsole(entry);
        // Also call external log utility if present so other modules can capture logs
        try {
            if (typeof log === "function") log(entry);
        } catch (err) {
            // ignore errors from external log
        }
    }

    // Utility to scroll console (explicit)
    renderer_scrollConsoleToBottom() {
        if (this.dom.emulatorConsole) {
            this.dom.emulatorConsole.scrollTop =
                this.dom.emulatorConsole.scrollHeight;
        }
    }

    // Very small utility to escape HTML when inserting text
    escapeHtml(text) {
        if (text == null) return "";
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\n/g, "<br>");
    }
}

export const emulator = new Emulator();

window.__emulator = emulator;
