import * as vscode from "vscode";
import { showRibbonInputBox, showRibbonQuickPick } from "./ribbonPromptUi";

export interface RibbonLanguageCodePick extends vscode.QuickPickItem {
  languageCode?: number;
  manual?: boolean;
}

interface RibbonLanguageCode {
  code: number;
  name: string;
  locale: string;
}

const DEFAULT_LANGUAGE_CODE = 1033;
const CUSTOM_LANGUAGE_CODE = "Type language code";

const RIBBON_LANGUAGE_CODES: RibbonLanguageCode[] = [
  { code: 1025, name: "Arabic", locale: "ar-SA" },
  { code: 1026, name: "Bulgarian", locale: "bg-BG" },
  { code: 1027, name: "Catalan", locale: "ca-ES" },
  { code: 1028, name: "Chinese (Traditional)", locale: "zh-TW" },
  { code: 1029, name: "Czech", locale: "cs-CZ" },
  { code: 1030, name: "Danish", locale: "da-DK" },
  { code: 1031, name: "German", locale: "de-DE" },
  { code: 1032, name: "Greek", locale: "el-GR" },
  { code: 1033, name: "English (United States)", locale: "en-US" },
  { code: 1035, name: "Finnish", locale: "fi-FI" },
  { code: 1036, name: "French", locale: "fr-FR" },
  { code: 1037, name: "Hebrew", locale: "he-IL" },
  { code: 1038, name: "Hungarian", locale: "hu-HU" },
  { code: 1040, name: "Italian", locale: "it-IT" },
  { code: 1041, name: "Japanese", locale: "ja-JP" },
  { code: 1042, name: "Korean", locale: "ko-KR" },
  { code: 1043, name: "Dutch", locale: "nl-NL" },
  { code: 1044, name: "Norwegian (Bokmal)", locale: "nb-NO" },
  { code: 1045, name: "Polish", locale: "pl-PL" },
  { code: 1046, name: "Portuguese (Brazil)", locale: "pt-BR" },
  { code: 1048, name: "Romanian", locale: "ro-RO" },
  { code: 1049, name: "Russian", locale: "ru-RU" },
  { code: 1050, name: "Croatian", locale: "hr-HR" },
  { code: 1051, name: "Slovak", locale: "sk-SK" },
  { code: 1053, name: "Swedish", locale: "sv-SE" },
  { code: 1054, name: "Thai", locale: "th-TH" },
  { code: 1055, name: "Turkish", locale: "tr-TR" },
  { code: 1057, name: "Indonesian", locale: "id-ID" },
  { code: 1058, name: "Ukrainian", locale: "uk-UA" },
  { code: 1060, name: "Slovenian", locale: "sl-SI" },
  { code: 1061, name: "Estonian", locale: "et-EE" },
  { code: 1062, name: "Latvian", locale: "lv-LV" },
  { code: 1063, name: "Lithuanian", locale: "lt-LT" },
  { code: 1066, name: "Vietnamese", locale: "vi-VN" },
  { code: 1069, name: "Basque", locale: "eu-ES" },
  { code: 1081, name: "Hindi", locale: "hi-IN" },
  { code: 1086, name: "Malay", locale: "ms-MY" },
  { code: 1087, name: "Kazakh", locale: "kk-KZ" },
  { code: 1088, name: "Kyrgyz", locale: "ky-KG" },
  { code: 1089, name: "Swahili", locale: "sw-KE" },
  { code: 1091, name: "Uzbek", locale: "uz-Latn-UZ" },
  { code: 1094, name: "Punjabi", locale: "pa-IN" },
  { code: 1095, name: "Bengali (India)", locale: "bn-IN" },
  { code: 1097, name: "Tamil", locale: "ta-IN" },
  { code: 1099, name: "Kannada", locale: "kn-IN" },
  { code: 1100, name: "Malayalam", locale: "ml-IN" },
  { code: 1102, name: "Marathi", locale: "mr-IN" },
  { code: 1106, name: "Welsh", locale: "cy-GB" },
  { code: 1110, name: "Galician", locale: "gl-ES" },
];

export function listRibbonLanguageCodePicks(
  options: {
    currentLanguageCode?: number;
    preferredLanguageCode?: number;
    unavailableLanguageCodes?: readonly number[];
  } = {},
): RibbonLanguageCodePick[] {
  const unavailable = new Set(options.unavailableLanguageCodes ?? []);
  if (options.currentLanguageCode !== undefined) {
    unavailable.delete(options.currentLanguageCode);
  }

  const picks = RIBBON_LANGUAGE_CODES.filter((language) => !unavailable.has(language.code)).map(
    (language) => ({
      label: language.name,
      description:
        language.code === options.currentLanguageCode
          ? `${language.code} - Current language`
          : String(language.code),
      detail: language.locale,
      languageCode: language.code,
    }),
  );
  const currentKnown = picks.some((pick) => pick.languageCode === options.currentLanguageCode);
  if (options.currentLanguageCode !== undefined && !currentKnown) {
    picks.unshift({
      label: "Unknown language",
      description: `${options.currentLanguageCode} - Current language`,
      detail: "Custom LCID",
      languageCode: options.currentLanguageCode,
    });
  }

  const firstCode = options.currentLanguageCode ?? options.preferredLanguageCode;
  const firstIndex = picks.findIndex((pick) => pick.languageCode === firstCode);
  if (firstIndex > 0) {
    picks.unshift(...picks.splice(firstIndex, 1));
  }

  return [
    ...picks,
    {
      label: CUSTOM_LANGUAGE_CODE,
      description: "Use another LCID",
      manual: true,
    },
  ];
}

export async function promptRibbonLanguageCode(
  options: {
    currentLanguageCode?: number;
    unavailableLanguageCodes?: readonly number[];
  } = {},
): Promise<number | undefined> {
  const picks = listRibbonLanguageCodePicks({
    currentLanguageCode: options.currentLanguageCode,
    preferredLanguageCode: DEFAULT_LANGUAGE_CODE,
    unavailableLanguageCodes: options.unavailableLanguageCodes,
  });
  const pick = await showRibbonQuickPick<RibbonLanguageCodePick>(picks, {
    placeHolder: "Language",
  });
  if (!pick) {
    return undefined;
  }

  if (!pick.manual) {
    return pick.languageCode;
  }

  const firstPick = picks.find((item) => item.languageCode !== undefined);
  const languageCode = await showRibbonInputBox({
    prompt: "Language code",
    value: String(options.currentLanguageCode ?? firstPick?.languageCode ?? DEFAULT_LANGUAGE_CODE),
    validateInput: (value) =>
      validateLanguageCodeInput(value, options.unavailableLanguageCodes ?? []),
  });

  return languageCode === undefined ? undefined : Number(languageCode.trim());
}

function validateLanguageCodeInput(
  value: string,
  unavailableLanguageCodes: readonly number[] = [],
): string | undefined {
  const code = value.trim();
  if (!/^\d+$/.test(code)) {
    return "Language code must be a number.";
  }

  return unavailableLanguageCodes.includes(Number(code))
    ? "This LocLabel already has this language."
    : undefined;
}
