/**
 * useSpeechRecognition — 浏览器语音识别 Hook
 *
 * 基于 Web Speech API（webkitSpeechRecognition），
 * 在 Tauri 的 Chromium webview 中可用。
 */

import { useState, useRef, useCallback } from "react";

export interface SpeechRecognitionState {
  /** 是否正在录音 */
  listening: boolean;
  /** 当前识别的中间文本 */
  interimText: string;
  /** 是否支持语音识别 */
  supported: boolean;
  /** 触发错误信息 */
  error: string | null;
}

export interface SpeechRecognitionActions {
  /** 开始录音 */
  start: () => void;
  /** 停止录音 */
  stop: () => void;
  /** 清空识别的文本 */
  reset: () => void;
}

/**
 * 语音识别 Hook
 * @param onResult 识别完成后的回调（最终文本）
 * @param onInterim 实时识别回调，语音期间持续推送当前识别的文本（final + interim）
 * @param lang 语言（默认 zh-CN）
 */
export function useSpeechRecognition(
  onResult?: (text: string) => void,
  onInterim?: (text: string) => void,
  lang = "zh-CN",
): SpeechRecognitionState & SpeechRecognitionActions {
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const finalTextRef = useRef("");
  /** 标记是否为手动停止，避免 onend 重复触发 onResult */
  const stoppedByUserRef = useRef(false);

  const supported =
    typeof window !== "undefined" &&
    (("SpeechRecognition" in window) ||
     ("webkitSpeechRecognition" in window));

  const stop = useCallback(() => {
    stoppedByUserRef.current = true;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      try { recognitionRef.current.abort(); } catch {}
    }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (!supported) {
      setError("浏览器不支持语音识别");
      return;
    }

    // 清除旧实例
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }

    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    stoppedByUserRef.current = false;

    recognition.onstart = () => {
      setListening(true);
      setError(null);
    };

    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (final) {
        finalTextRef.current += final;
      }
      setInterimText(interim);
      // 实时推送识别的文本（final + interim），让调用方实时填入输入框
      if (onInterim) {
        onInterim(finalTextRef.current + interim);
      }
    };

    recognition.onerror = (event: any) => {
      console.warn("[SpeechRecognition] error:", event.error);
      if (event.error === "no-speech" || event.error === "aborted") {
        return;
      }
      setError(`语音识别错误: ${event.error}`);
      setListening(false);
    };

    recognition.onend = () => {
      // 手动停止 -> 触发 onResult
      if (stoppedByUserRef.current) {
        setListening(false);
        const finalText = finalTextRef.current.trim();
        if (finalText && onResult) {
          onResult(finalText);
        }
        finalTextRef.current = "";
        setInterimText("");
        return;
      }

      // 非手动停止（如静音超时）-> 自动重启
      try { recognition.start(); } catch {}
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (e: any) {
      setError("启动语音识别失败: " + (e.message || ""));
    }
  }, [supported, lang, onResult, onInterim]);

  const reset = useCallback(() => {
    finalTextRef.current = "";
    setInterimText("");
    setError(null);
  }, []);

  return {
    listening,
    interimText,
    supported,
    error,
    start,
    stop,
    reset,
  };
}
