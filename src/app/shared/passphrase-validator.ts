export interface PassphraseValidationResult {
  isValid: boolean;
  message?: string;
  entropyBits?: number;
}

export function calculatePassphraseEntropy(passphrase: string): number {
  if (!passphrase) return 0;

  // Determine character set size (N)
  let poolSize = 0;
  if (/[a-z]/.test(passphrase)) poolSize += 26;
  if (/[A-Z]/.test(passphrase)) poolSize += 26;
  if (/[0-9]/.test(passphrase)) poolSize += 10;
  // Symbols and whitespace (space, punctuation, special characters = 33 symbols)
  if (/[^a-zA-Z0-9]/.test(passphrase)) poolSize += 33;

  if (poolSize === 0) return 0;

  // Base information entropy: E = L * log2(N)
  const rawEntropy = passphrase.length * Math.log2(poolSize);

  // Penalize character repetition (e.g. "aaaaaa", "12121212")
  const uniqueChars = new Set(passphrase).size;
  const uniquenessRatio = uniqueChars / passphrase.length;
  
  // Scale entropy down if uniqueness ratio is low
  const effectiveEntropy = rawEntropy * Math.min(1, uniquenessRatio * 1.25);

  return Math.round(effectiveEntropy * 10) / 10;
}

export function evaluatePassphraseStrength(passphrase: string): PassphraseValidationResult {
  if (!passphrase || passphrase.length < 12) {
    return { 
      isValid: false, 
      message: 'Passphrase must be at least 12 characters long.' 
    };
  }

  const lower = passphrase.toLowerCase().trim();

  // Rejection rule 1: Single repeated character
  if (/^(.)\1+$/.test(lower)) {
    return { 
      isValid: false, 
      message: 'Passphrase cannot consist of a single repeated character.' 
    };
  }

  // Rejection rule 2: Common weak dictionary roots and keyboard sequences (word-level matching)
  const commonWeakRegex = /\b(password|123456|qwerty|admin|welcome|change_me|masterkey|iloveyou|letmein)\b/i;

  if (commonWeakRegex.test(lower)) {
    return { 
      isValid: false, 
      message: 'Passphrase contains a common word or keyboard pattern. Choose a unique phrase.' 
    };
  }

  // Rejection rule 3: Entropy threshold check (must be at least 50 bits of entropy)
  const entropyBits = calculatePassphraseEntropy(passphrase);
  if (entropyBits < 50) {
    return { 
      isValid: false, 
      entropyBits,
      message: 'Passphrase is too simple. Use spaces between words (e.g. "correct horse battery staple"), numbers, or symbols.' 
    };
  }

  return { isValid: true, entropyBits };
}

export function generateRandomPassphrase(wordCount = 6): string {
  const WORD_LIST = [
    'anchor', 'beacon', 'breeze', 'bridge', 'canyon', 'castle', 'cedar', 'cobalt',
    'comet', 'crystal', 'desert', 'diamond', 'dragon', 'echo', 'ember', 'falcon',
    'forest', 'fountain', 'galaxy', 'glacier', 'harbor', 'horizon', 'island', 'jungle',
    'lagoon', 'lantern', 'legend', 'meadow', 'meteor', 'mountain', 'nebula', 'oasis',
    'ocean', 'orbit', 'orchid', 'panther', 'pebble', 'phoenix', 'planet', 'portal',
    'prairie', 'prism', 'pulsar', 'pyramid', 'quantum', 'quartz', 'river', 'shadow',
    'shield', 'sierra', 'silver', 'solaris', 'spark', 'sphinx', 'spring', 'starlight',
    'summit', 'sunrise', 'sunset', 'tempest', 'thunder', 'timber', 'topaz', 'torrent',
    'trident', 'tundra', 'twilight', 'valley', 'velvet', 'vortex', 'whisper', 'zenith'
  ];

  const array = new Uint32Array(wordCount);
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < wordCount; i++) {
      array[i] = Math.floor(Math.random() * 4294967296);
    }
  }

  const selectedWords: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    const index = array[i] % WORD_LIST.length;
    selectedWords.push(WORD_LIST[index]);
  }

  return selectedWords.join('-');
}

