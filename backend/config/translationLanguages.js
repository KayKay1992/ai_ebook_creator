// Languages a book can be AI-translated into. Edit this list to add or
// remove one: the admin Translations tab, the reader's language selector
// and the public book page all read it from the API, so nothing in the
// frontend needs changing.
//
//   code         stored on BookTranslation.language and used in URLs (BCP-47-ish)
//   name         English name, shown to admins and in the selector
//   nativeName   shown to readers next to the English name
//   promptName   how the translation prompt names the language for Gemini
//   listenMode   whether the browser's device voice (Listen Mode) is offered
//                for this language; off where device voices mispronounce it
//   speechLang   language prefix Listen Mode picks a device voice for
const TRANSLATION_LANGUAGES = [
    {
        code: 'pcm',
        name: 'Nigerian Pidgin',
        nativeName: 'Naijá',
        promptName: 'Nigerian Pidgin English (Naijá), as written by Nigerian Pidgin writers and broadcasters',
        listenMode: false,
    },
    { code: 'yo', name: 'Yoruba', nativeName: 'Yorùbá', promptName: 'Yoruba (with correct tone marks)', listenMode: false },
    { code: 'ig', name: 'Igbo', nativeName: 'Igbo', promptName: 'Igbo (with standard orthography)', listenMode: false },
    { code: 'ha', name: 'Hausa', nativeName: 'Hausa', promptName: 'Hausa (Boko, Latin script)', listenMode: false },
    { code: 'fr', name: 'French', nativeName: 'Français', promptName: 'French', listenMode: true, speechLang: 'fr' },
];

const LANGUAGE_BY_CODE = new Map(TRANSLATION_LANGUAGES.map((language) => [language.code, language]));

const getLanguage = (code) => LANGUAGE_BY_CODE.get(String(code || '')) || null;

// What the frontend may see about a language (no prompt wording).
const publicLanguage = ({ code, name, nativeName, listenMode, speechLang }) => ({
    code,
    name,
    nativeName,
    listenMode: Boolean(listenMode),
    speechLang: speechLang || '',
});

module.exports = { TRANSLATION_LANGUAGES, getLanguage, publicLanguage };
