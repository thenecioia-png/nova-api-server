import { useState, useEffect, useCallback, useRef } from "react";

// Add missing window types for speech recognition
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface UseVoiceProps {
  onResult: (text: string) => void;
}

export function useVoice({ onResult }: UseVoiceProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [supported, setSupported] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  
  const recognitionRef = useRef<any>(null);
  const synthesisRef = useRef<SpeechSynthesis | null>(null);
  const preferredVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSupported(false);
      return;
    }

    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = false;
    recognitionRef.current.interimResults = false;
    recognitionRef.current.lang = 'es-DO'; // Spanish (Dominican Republic)

    recognitionRef.current.onstart = () => {
      setIsListening(true);
    };

    recognitionRef.current.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      onResult(transcript);
    };

    recognitionRef.current.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
    };

    recognitionRef.current.onend = () => {
      setIsListening(false);
    };

    // Initialize Speech Synthesis
    if ('speechSynthesis' in window) {
      synthesisRef.current = window.speechSynthesis;
      
      const loadVoices = () => {
        const voices = synthesisRef.current?.getVoices() || [];
        // Try to find a Spanish Dominican female voice, fallback to other Spanish female voices
        let bestVoice = voices.find(v => v.lang === 'es-DO' && v.name.includes('Female'));
        if (!bestVoice) bestVoice = voices.find(v => v.lang.startsWith('es') && (v.name.includes('Female') || v.name.includes('Mujer') || v.name.includes('Paulina') || v.name.includes('Monica')));
        if (!bestVoice) bestVoice = voices.find(v => v.lang.startsWith('es'));
        
        preferredVoiceRef.current = bestVoice || voices[0];
      };

      loadVoices();
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = loadVoices;
      }
    }
  }, [onResult]);

  const startListening = useCallback(() => {
    if (!supported || !recognitionRef.current) return;
    
    // Stop any ongoing speech output when listening starts
    if (synthesisRef.current?.speaking) {
      synthesisRef.current.cancel();
      setIsSpeaking(false);
    }
    
    try {
      recognitionRef.current.start();
    } catch (e) {
      console.error("Recognition already started", e);
    }
  }, [supported]);

  const stopListening = useCallback(() => {
    if (!supported || !recognitionRef.current) return;
    recognitionRef.current.stop();
    setIsListening(false);
  }, [supported]);

  const toggleListening = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, startListening, stopListening]);

  const speak = useCallback((text: string) => {
    if (!supported || !synthesisRef.current || !voiceEnabled) return;
    
    // Strip markdown so the voice reads naturally like a person
    const clean = text
      .replace(/```[\s\S]*?```/g, "código")           // code blocks -> "código"
      .replace(/`([^`]+)`/g, "$1")                    // inline code -> just the text
      .replace(/\*\*\*(.+?)\*\*\*/g, "$1")            // ***bold italic*** -> text
      .replace(/\*\*(.+?)\*\*/g, "$1")                // **bold** -> text
      .replace(/\*(.+?)\*/g, "$1")                    // *italic* -> text
      .replace(/___(.+?)___/g, "$1")                  // ___bold italic___ -> text
      .replace(/__(.+?)__/g, "$1")                    // __bold__ -> text
      .replace(/_(.+?)_/g, "$1")                      // _italic_ -> text
      .replace(/~~(.+?)~~/g, "$1")                    // ~~strikethrough~~ -> text
      .replace(/^#{1,6}\s+/gm, "")                    // # headings -> text only
      .replace(/^\s*[-*+]\s+/gm, "")                  // bullet list markers -> nothing
      .replace(/^\s*\d+\.\s+/gm, "")                  // numbered lists -> nothing
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")        // [text](url) -> text
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")       // ![alt](img) -> alt
      .replace(/^>\s+/gm, "")                         // > blockquote -> nothing
      .replace(/[-]{3,}/g, "")                        // --- horizontal rule -> nothing
      .replace(/\|/g, ", ")                           // table pipes -> comma
      .replace(/\n{3,}/g, "\n\n")                     // collapse extra newlines
      .trim();
    
    // Stop current speech
    synthesisRef.current.cancel();
    
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = 'es-DO';
    utterance.rate = 1.05; // Slightly faster for conversational feel
    utterance.pitch = 1.1; // Slightly higher pitch for female voice
    
    if (preferredVoiceRef.current) {
      utterance.voice = preferredVoiceRef.current;
    }

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    synthesisRef.current.speak(utterance);
  }, [supported, voiceEnabled]);

  const toggleVoice = useCallback(() => {
    setVoiceEnabled(prev => {
      if (prev && isSpeaking) {
        synthesisRef.current?.cancel();
        setIsSpeaking(false);
      }
      return !prev;
    });
  }, [isSpeaking]);

  return {
    isListening,
    isSpeaking,
    supported,
    voiceEnabled,
    startListening,
    stopListening,
    toggleListening,
    speak,
    toggleVoice
  };
}
