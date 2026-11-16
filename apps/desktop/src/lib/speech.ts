// Speech to text for the chat, using the system's recognizer through the Web Speech API:
// on macOS the webview hands it to Apple's speech recognition (dictation), so no model is shipped.
// Where the webview has none (Linux's WebKitGTK) the mic button says so and points to the system's
// own dictation instead.
import { useCallback, useEffect, useRef, useState } from "react";

type Rec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

const ctor = (): (new () => Rec) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const speechSupported = () => !!ctor();

/** A recognition language: the system's when it matches the app's language, otherwise a sensible default. */
export function speechLang(app: "es" | "en"): string {
  const sys = typeof navigator !== "undefined" ? navigator.language : "";
  if (sys.toLowerCase().startsWith(app)) return sys;
  return app === "es" ? "es-ES" : "en-US";
}

/** What to tell the user for each error the recognizer reports. Spanish source strings (see i18n). */
export function speechErrorHint(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "No tengo permiso para usar el micrófono o el reconocimiento de voz. Habilitalos para AI WorkStudio en los ajustes de privacidad del sistema.";
    case "audio-capture":
      return "No encontré un micrófono.";
    case "network":
      return "El reconocimiento de voz del sistema no está disponible ahora (necesita conexión). Probá con el dictado del sistema.";
    case "language-not-supported":
      return "El sistema no reconoce este idioma por voz.";
    default:
      return "";
  }
}

/** `onText(full)` gets the text said so far in this recording (final + interim), to put after what was typed. */
export function useSpeech(lang: string, onText: (said: string) => void, onError: (code: string) => void) {
  const [listening, setListening] = useState(false);
  const rec = useRef<Rec | null>(null);
  const cb = useRef({ onText, onError });
  cb.current = { onText, onError };

  const stop = useCallback(() => {
    try {
      rec.current?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  /** Stops and drops whatever is still coming (used when the message is sent). */
  const cancel = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    r.onresult = null;
    try {
      r.abort();
    } catch {
      /* already stopped */
    }
  }, []);

  const start = useCallback(() => {
    const C = ctor();
    if (!C) return cb.current.onError("unsupported");
    stop();
    const r = new C();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      cb.current.onText(text.trim());
    };
    r.onerror = (e) => {
      // "no-speech" and "aborted" are normal ends, not failures.
      if (e.error !== "no-speech" && e.error !== "aborted") cb.current.onError(e.error || "error");
    };
    r.onend = () => {
      setListening(false);
      rec.current = null;
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
      cb.current.onError("error");
    }
  }, [lang, stop]);

  useEffect(() => () => rec.current?.abort(), []);
  return { listening, start, stop, cancel, supported: speechSupported() };
}
