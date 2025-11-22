// Loader.js

async function loadModifier(modifierPath, globals = {}) {
    // --- 1. Load Library.js and modifier file
    const [libResp, modResp] = await Promise.all([
        fetch('../Script/Library.js'),
        fetch(modifierPath)
    ]);

    if (!libResp.ok) throw new Error(`Failed to load Library.js: ${libResp.statusText}`);
    if (!modResp.ok) throw new Error(`Failed to load ${modifierPath}: ${modResp.statusText}`);

    const librarySource = await libResp.text();
    let modifierSource = await modResp.text();

    // --- 2. Append code to capture the return value of the modifier
    modifierSource = modifierSource.replace(
        /modifier\s*\(\s*text\s*\)\s*;?\s*$/, // matches last `modifier(text)` call
        'return modifier(text);'
    );
    // --- 3. Prepare globals injection code
    const globalsCode = Object.keys(globals)
        .map(key => `let ${key} = globals["${key}"];`)
        .join("\n");

    // --- 4. Create and execute the sandbox function
    const sandboxFunc = new Function('globals', `
    // --- Inject emulator globals as local variables
    ${globalsCode}

    // --- Execute Library.js first
    ${librarySource}
    
    // --- Then execute modifier file (with capture)
    ${modifierSource}
  `);

    return sandboxFunc(globals);
}

// --- 5. Export specialized functions
export async function runInputModifier(globals) {
    return loadModifier('../Script/Input.js', globals);
}

export async function runContextModifier(globals) {
    return loadModifier('../Script/Context.js', globals);
}

export async function runOutputModifier(globals) {
    return loadModifier('../Script/Output.js', globals);
}
