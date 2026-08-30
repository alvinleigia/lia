export const SUPPORTED_CONVERSATION_LANGUAGES = ["English"] as const;

export function getConversationLanguageOptions(currentLanguage: string) {
  const normalizedCurrentLanguage = currentLanguage.trim();
  if (
    SUPPORTED_CONVERSATION_LANGUAGES.some(
      (language) => language === normalizedCurrentLanguage,
    )
  ) {
    return [...SUPPORTED_CONVERSATION_LANGUAGES];
  }

  return [normalizedCurrentLanguage, ...SUPPORTED_CONVERSATION_LANGUAGES];
}

export function isAllowedConversationLanguage(
  language: string,
  currentLanguage: string,
) {
  return getConversationLanguageOptions(currentLanguage).includes(language);
}
