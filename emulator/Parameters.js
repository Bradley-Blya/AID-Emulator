// parameters.js
// --------------------------------------------------
// Centralized environment for sandboxed scripting.
// All persistent data and functions are defined here.
// Each symbol can be exposed globally so that scripts
// in the sandbox can reference them by name directly.
// --------------------------------------------------


/*
Each action object has fields:
  - text
  - rawText (deprecated, same as text)
  - type: 'start', 'continue', 'do', 'say', 'story', 'see'
*/

  // --------------------
  // Data parameters
  // --------------------

  // Array of recent actions
  export const history = []; 

  // Persistent story cards
  export const storyCards = [];
  export const worldInfo = storyCards; // backwards compatibility

  // Persistent arbitrary state object
  export const state = {
    memory: {
      context: "",
      authorsNote: "",
      frontMemory: ""
    },
  };

  // info

  export const info = {
      characterNames: [],
      actionCount: 0,
      maxChars: 0,
      memoryLength: 0,
  };

// --------------------
// Functions
// --------------------

// Logging

// --------------------
// Story card functions
// --------------------

// Add a story card
export function addStoryCard(keys, entry, type = "general") {
  const keyString = JSON.stringify(keys);
  const exists = storyCards.some(card => JSON.stringify(card.keys) === keyString);
  if (exists) return false;

  const newCard = {
    id: storyCards.length,
    keys,
    entry,
    type
  };
  storyCards.push(newCard);
  return storyCards.length - 1;
}

// Remove a story card
export function removeStoryCard(index) {
  if (index < 0 || index >= storyCards.length) {
    throw new Error("Story card does not exist");
  }
  storyCards.splice(index, 1);
}

// Update a story card
export function updateStoryCard(index, keys, entry, type = "general") {
  if (index < 0 || index >= storyCards.length) {
    throw new Error("Story card does not exist");
  }
  storyCards[index] = { id: index, keys, entry, type };
}
