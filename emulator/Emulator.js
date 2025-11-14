// emulator/emulator.js //test edit

// External dependencies (these should exist in your project)
import {
  state,
  storyCards,
  history,
  addStoryCard,
  removeStoryCard,
  updateStoryCard,
  //log
} from "./Parameters.js";

import { loadLibrarySandbox } from "./Loader.js";

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
    // Hooks (filled during initSandbox)
    this.hooks = {
      inputModifier: (t) => t,
      contextModifier: (c) => c,
      outputModifier: (o) => o,
    };

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
  async init() {
    // 1) Load sandbox hooks safely
    await this.initSandbox();

    // 2) Wire DOM elements
    this.wireDOM();

    // 3) Initial render
    this.renderer_log("Dungeon AI Simulator initialized.");
    this.renderer_updateMainView(); // show initial content
    this.renderer_scrollConsoleToBottom();
  }

  /* -------------------------
     Load sandbox hooks from sandboxLoader
     sandboxLoader should return { inputModifier, contextModifier, outputModifier }
     Each hook should be a pure function that accepts a string and returns a string.
     If sandbox loading fails, fallback to identity functions.
     ------------------------- */
  async initSandbox() {
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

  /* -------------------------
     Public API:
     - handleInput(mode, text)
       Called when user clicks Enter or presses Enter. This is the single entry point
       for "a turn" in the emulator. UI must call this.
     ------------------------- */
  async handleInput(mode, text) {
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

  /* -------------------------
     User turn processing
     - mode: string (start/continue/do/say/story/see ...)
     - rawText: user raw input
     Flow:
       1. Apply inputModifier hook
       2. Push to history (with mode info)
       3. Rebuild context (join history -> apply contextModifier -> write to state.memory)
     ------------------------- */
  processUserTurn(mode, rawText) {
    try {
      this.renderer_log(`Processing user input (mode=${mode})...`);

      // 1) Hook: inputModifier
      const modified = this.safeCallHook("inputModifier", rawText);

      // 2) Update history (we keep mode for clarity)
      const entry = `user(${mode}) ${modified}`;
      history.push(entry);

      // Optionally update other places in state.memory (frontMemory etc)
      // For now keep only the canonical context field updated by rebuildContext
      this.rebuildContext();

      this.renderer_log(`User -> ${modified}`);
    } catch (err) {
      this.renderer_log("Error processing user turn: " + err.message);
      console.error(err);
    }
  }

  /* -------------------------
     AI turn processing
     - rawText: should be AI-generated text (the emulator treats it as given)
     Flow:
       1. Apply outputModifier
       2. Push to history
       3. Rebuild context
     Notes:
       - In a full system, `rawText` might come from an LLM call; here the UI can
         let you paste/type the AI output for testing.
     ------------------------- */
  processAITurn(rawText) {
    try {
      this.renderer_log(`Processing AI output...`);

      // 1) Hook: outputModifier
      const modified = this.safeCallHook("outputModifier", rawText);

      // 2) Update history
      const entry = `ai ${modified}`;
      history.push(entry);

      // 3) Rebuild context
      this.rebuildContext();

      this.renderer_log(`AI -> ${modified}`);
    } catch (err) {
      this.renderer_log("Error processing AI turn: " + err.message);
      console.error(err);
    }
  }

  /* -------------------------
     rebuildContext()
     - single place to reconstruct the context from history and apply contextModifier
     - updates state.memory.context and state.memory.frontMemory (if used)
     ------------------------- */
  rebuildContext() {
    // Rebuild raw context from history lines
    const rawContext = history.join("\n") + "\n";

    // Save into state memory (so other modules can inspect)
    state.memory.context = rawContext;
    // Reset or preserve frontMemory according to your design; here's a default:
    state.memory.frontMemory = state.memory.frontMemory || "";

    // Apply contextModifier hook to produce the AI-facing context
    const aiContext = this.safeCallHook("contextModifier", state.memory.context);

    // We store the transformed context as well (useful for debugging / AI preview)
    state.memory.transformedContext = aiContext;

    // Also update any other memory fields if needed — keep single source of truth here
    this.renderer_log("Context rebuilt and transformed.");
  }

  /* -------------------------
     safeCallHook(name, arg)
     Utility to call a hook safely (try/catch + identity fallback)
     ------------------------- */
  safeCallHook(name, arg) {
    try {
      const fn = this.hooks[name];
      if (typeof fn !== "function") return arg;
      const out = fn(arg);
      // If hook returns Promise, resolve synchronously via await pattern would be needed.
      // But we expect synchronous hooks for speed and determinism.
      return typeof out === "string" ? out : String(out);
    } catch (err) {
      // Hook crashed; don't let that break the emulator
      console.error(`Hook ${name} threw:`, err);
      this.renderer_log(`(Hook ${name} failed; using identity)`);
      return arg;
    }
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

  // Attach DOM references and event listeners
  wireDOM() {
    // Query DOM and keep references; fail gracefully if elements are missing
    this.dom.mainTextWindow = document.getElementById("mainScreen");
    this.dom.emulatorConsole = document.getElementById("emulatorConsole");
    this.dom.inputField = document.getElementById("emulatorInput");
    this.dom.enterBtn = document.getElementById("emulatorSubmit");
    this.dom.modeButtons = Array.from(document.querySelectorAll("#modeButtons button"));
    this.dom.tabButtons = Array.from(document.querySelectorAll("#topTabs .tab"));


// IF YOU LATER ADD real tab panels:
this.dom.tabPanels = []; // leave empty or add when created



    // Ensure required elements exist
    if (!this.dom.mainTextWindow || !this.dom.emulatorConsole || !this.dom.inputField || !this.dom.enterBtn) {
      console.warn("Emulator: some DOM elements not found. Make sure the HTML matches expected IDs.");
    }

    // Mode button behavior
    if (this.dom.modeButtons && this.dom.modeButtons.length) {
      // Initialize selected mode from DOM if a button already has 'active'
      const activeBtn = this.dom.modeButtons.find(b => b.classList.contains("active"));
      if (activeBtn) this.selectedMode = activeBtn.dataset.mode || this.selectedMode;
      // Wire click events
      this.dom.modeButtons.forEach(btn => {
        btn.addEventListener("click", (e) => {
          this.setSelectedMode(btn.dataset.mode);
        });
      });
    }

    // Enter button calls handleInput with selectedMode and text from input field
    this.dom.enterBtn.addEventListener("click", (e) => {
      const txt = (this.dom.inputField && this.dom.inputField.value) || "";
      // Clear input field immediately (UI convenience)
      if (this.dom.inputField) this.dom.inputField.value = "";
      // Call the emulator entrypoint
      this.handleInput(this.selectedMode, txt);
    });

    // Also support pressing Enter in the text field
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

    // Optional: wire tab switching for top tabs
    if (this.dom.tabButtons && this.dom.tabButtons.length) {
      this.dom.tabButtons.forEach(tab => {
        tab.addEventListener("click", () => {
          this.switchTab(tab.dataset.tab);
        });
      });
    }
  }

  /* -------------------------
     setSelectedMode(mode)
     - updates internal selectedMode and toggles active class on buttons
     ------------------------- */
  setSelectedMode(mode) {
    this.selectedMode = mode;
    // toggle active UI state
    if (this.dom.modeButtons) {
      this.dom.modeButtons.forEach(btn => {
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
    this.dom.tabPanels.forEach(panel => {
      if (panel.id === tabId) panel.classList.remove("hidden");
      else panel.classList.add("hidden");
    });
    // toggle active on tab buttons
    if (this.dom.tabButtons) {
      this.dom.tabButtons.forEach(btn => {
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
  renderer_updateMainView() {
    if (!this.dom.mainTextWindow) return;

    // Decide what to show depending on currentSide
    if (this.currentSide === "user") {
      // Show the last N history lines (user facing view)
      const maxEntries = 10;
      const recent = history.slice(-maxEntries);
      const userViewHtml = recent.map(line => this.escapeHtml(line)).join("<br>");
      this.dom.mainTextWindow.innerHTML = `<b>User View (last ${maxEntries}):</b><br>${userViewHtml}<hr><b>User Input:</b><br>`;
    } else {
      // AI view: show transformed context and front memory
      const ctx = this.escapeHtml(state.memory.transformedContext || state.memory.context || "");
      const frontMem = this.escapeHtml(state.memory.frontMemory || "");
      this.dom.mainTextWindow.innerHTML = `<b>=== AI Context View ===</b><br><br>${ctx.replace(/\n/g, "<br>")}<hr><br><b>FrontMemory:</b><br>${frontMem}<br><b>AI output will go here...</b><br>`;
    }

    // Update console and other UI bits as needed
    this.renderer_updateConsoleSnapshot();
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
    this.dom.emulatorConsole.scrollTop = this.dom.emulatorConsole.scrollHeight;
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
      this.dom.emulatorConsole.scrollTop = this.dom.emulatorConsole.scrollHeight;
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

/* ==================================================================================
   Export a single Emulator instance and start it.
   - Other modules (editor, UI bridge) can import { emulator } and call emulator.handleInput(...)
   - We call start/init automatically here (init is async inside constructor)
   ================================================================================== */

export const emulator = new Emulator();

// If you want a default global for debugging or quick access in the console:
window.__emulator = emulator;

/* ==================================================================================
   Example usage (wired in HTML):
   - Mode buttons must have data-mode attributes (e.g. <button data-mode="say">say</button>)
   - Input field id: #emulatorInput
   - Enter button id: #emulatorEnter
   - Main text area id: #mainTextWindow
   - Console id: #emulatorConsole
   ================================================================================== */

/* ==================================================================================
   Notes & next steps you might want to implement:
   - If your hooks are async (e.g. call out to an LLM or remote script), you can adapt
     safeCallHook to support Promise-returning hooks (await the result).
   - If you want the emulator to automatically generate AI outputs (call LLM),
     implement an async `generateAIResponse()` inside Emulator and call it after
     processUserTurn() instead of switching immediately to AI input mode.
   - If you want story-cards to be injected automatically into the context, do that
     in rebuildContext() before calling contextModifier.
   - You can easily move renderer methods to a separate file (renderer.js) and import them.
   ================================================================================== */

