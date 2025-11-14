// sandboxLoader.js

async function loadModifier(modifierPath, globals = {}) {
  // --- 1. Load Library.js and modifier file
  const [libResp, modResp] = await Promise.all([
    fetch('./Library.js'),
    fetch(modifierPath)
  ]);

  if (!libResp.ok) throw new Error(`Failed to load Library.js: ${libResp.statusText}`);
  if (!modResp.ok) throw new Error(`Failed to load ${modifierPath}: ${modResp.statusText}`);

  const librarySource = await libResp.text();
  let modifierSource = await modResp.text();

  // --- 2. Append code to capture the return value of the modifier
  modifierSource += `\n__modifierReturn = modifier(text);`;

  // --- 3. Ensure we have a return capture key
  if (!globals.__modifierReturn) globals.__modifierReturn = undefined;

  // --- 4. Create and execute the sandbox function
  const sandboxFunc = new Function('globals', `
    // Spread all provided globals onto globalThis
    Object.assign(globalThis, globals);

    // --- Execute Library.js first
    ${librarySource}

    // --- Then execute modifier.js (with capture)
    ${modifierSource}

    // --- Return captured modifier result
    return globals.__modifierReturn;
  `);

  return sandboxFunc(globals);
}

// --- 5. Export specialized functions
export async function runInputModifier(globals) {
  return loadModifier('./Input.js', globals);
}

export async function runContextModifier(globals) {
  return loadModifier('./Context.js', globals);
}

export async function runOutputModifier(globals) {
  return loadModifier('./Output.js', globals);
}
