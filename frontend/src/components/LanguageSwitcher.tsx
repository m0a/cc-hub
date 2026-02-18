import { useTranslation } from 'react-i18next';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const toggleLanguage = () => {
    const newLang = i18n.language === 'ja' ? 'en' : 'ja';
    i18n.changeLanguage(newLang);
  };

  return (
    <button
      onClick={toggleLanguage}
      className="px-2 py-1 text-xs text-th-text-secondary hover:text-th-text hover:bg-th-surface-hover rounded transition-colors"
      title={i18n.language === 'ja' ? 'Switch to English' : '日本語に切替'}
    >
      {i18n.language === 'ja' ? 'EN' : 'JA'}
    </button>
  );
}
