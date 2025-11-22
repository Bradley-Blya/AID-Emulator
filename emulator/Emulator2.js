// emulator/emulator.js

// External dependencies (these should exist in your project)
import 
{
    state,
    storyCards,
    history,
    addStoryCard,
    removeStoryCard,
    updateStoryCard,
    //log
} from "./Parameters.js";

import 
{
    runInputModifier,
    runContextModifier,
    runOutputModifier
} from "./Loader.js";

class Emulator 
{
    constructor(opts = {}) 
    {

        // State managed here uses your imported `state` and `history`.
        // Keep emulator-specific transient state local:
        this.currentSide = "user"; // "user" or "ai"
        this.selectedMode = "say"; // default selected input mode
        this.dom = {}; // will hold DOM references after wiring

        // Optional logger function from parameters.js or opts
        this.log = typeof log === "function" ? log : (msg) => console.log(msg);

        // Kick off async initialization
        this._initPromise = this.init(); // allows callers to await if needed
    }

  /* -------------------------
     Async initialization:
     - load sandbox hooks
     - wire UI elements and listeners
     - render initial state
     ------------------------- */
    async init() 
    {

        // 1) Wire DOM elements
        this.wireDOM();

        // 2) Initial render
        this.renderer_log("Dungeon AI Simulator initialized.");
        this.renderer_updateMainView(); // show initial content
        this.renderer_scrollConsoleToBottom();
    }

    async initSandbox() 
    {
        try {
        const sandboxExports = await loadLibrarySandbox(state);
        // Ensure the hooks exist and are functions; fall back otherwise.
        this.hooks.inputModifier =
            typeof sandboxExports.inputModifier === "function"
            ? sandboxExports.inputModifier
            : this.hooks.inputModifier;
        this.hooks.contextModifier =
            typeof sandboxExports.contextModifier === "function"
            ? sandboxExports.contextModifier
            : this.hooks.contextModifier;
        this.hooks.outputModifier =
            typeof sandboxExports.outputModifier === "function"
            ? sandboxExports.outputModifier
            : this.hooks.outputModifier;

        this.renderer_log("Sandbox hooks loaded.");
        } catch (err) {
        this.renderer_log("Warning: failed to load sandbox hooks. Using identity hooks.");
        console.error(err);
        }
    }

    async handleInput(mode, text) 
    {
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
            // User's turn: we apply inputModifier and update history/context
            this.processUserTurn(mode, text);
            // After processing user turn, the next side is AI (by design)
            this.currentSide = "ai";
        } else {
            // AI's turn: we treat the incoming text as AI output,
            // apply outputModifier and update history/context
            this.processAITurn(text);
            // After AI output, go back to user
            this.currentSide = "user";
        }

        // Update UI to reflect changes
        this.renderer_updateMainView();
        this.renderer_scrollConsoleToBottom();
    }


}