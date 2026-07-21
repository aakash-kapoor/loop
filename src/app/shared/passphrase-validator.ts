export interface PassphraseValidationResult {
  isValid: boolean;
  message?: string;
}

export function evaluatePassphraseStrength(passphrase: string): PassphraseValidationResult {
  if (!passphrase || passphrase.length < 12) {
    return { 
      isValid: false, 
      message: 'Passphrase must be at least 12 characters long.' 
    };
  }

  const lower = passphrase.toLowerCase().trim();

  // Check single repeated character (e.g., "aaaaaaaaaaaa", "111111111111")
  if (/^(.)\1+$/.test(lower)) {
    return { 
      isValid: false, 
      message: 'Passphrase cannot consist of a single repeated character.' 
    };
  }

  // Common weak passphrases / predictable sequences
  const commonWeakPatterns = [
    'password1234', '123456789012', 'qwertyuiop12', 'abcdefghijkl',
    'password12345', 'administrator', 'welcome12345', 'change_me_123',
    'loopchat1234', 'masterkey123', 'iloveyou12345'
  ];

  if (commonWeakPatterns.some(pattern => lower.includes(pattern))) {
    return { 
      isValid: false, 
      message: 'Passphrase is too common or predictable. Choose a unique phrase.' 
    };
  }

  // Check character diversity (passphrases should have multiple words, digits, or symbols)
  const hasLetters = /[a-zA-Z]/.test(passphrase);
  const hasDigitsOrSymbols = /[^a-zA-Z]/.test(passphrase);
  const hasSpaces = /\s/.test(passphrase);

  // If it's single word under 16 chars without numbers, spaces, or symbols, require higher entropy
  if (hasLetters && !hasDigitsOrSymbols && !hasSpaces && passphrase.length < 16) {
    return { 
      isValid: false, 
      message: 'Passphrase is too simple. Use spaces between words (e.g. "correct horse battery staple"), numbers, or symbols.' 
    };
  }

  return { isValid: true };
}
