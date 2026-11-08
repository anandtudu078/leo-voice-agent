import { useState, useEffect, useRef } from "react";
import { Mic, Ear, Code } from "lucide-react";

export function VoicePanel() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [ws, setWs] = useState(null);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8000/ws/process-voice");
    setWs(ws);

    ws.onopen = () => {
      console.log("WebSocket connected");
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data as string);
      setTranscript(data.text || "");
      // Handle TTS speech response
      if (data.type === "speech" && data.speech) {
        const audioUrl = `data:audio/webm;base64,${data.speech}`;
        const audio = new Audio(audioUrl);
        audio.play().catch(() => console.log("Audio play blocked"));
        setReply(data.text || "Leo: I understood that, but I have nothing to do right now.");
      }
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected");
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    return () => {
      ws.close();
    };
  }, []);

  const startListening = () => {
    setIsListening(true);
  };

  const stopListening = () => {
    setIsListening(false);
    ws?.close();
    setWs(null);
  };

  return (
    <div>
      <Mic className="h-6 w-6" />
      <div className="ml-2">
        <span className="font-semibold">Listen</span>
        <span className="text-xs text-muted-foreground">{isListening ? "Active" : "Inactive"}</span>
      </div>
      <span className="text-sm mt-1">{transcript || "Click to listen"}</span>
      <br />
      {reply && (
        <div className="mt-3 p-3 rounded-lg bg-white/5">
          <Music className="h-5 w-5 text-primary" />
          <span className="font-medium">{reply}</span>
          <br />
          <audio controls className="w-full mt-2">
            <source src={reply.includes("data:")}
              ? reply
              : `data:audio/webm;base64,${reply}` type="audio/webm" />
          </audio>
        </div>
      )}
      <button onClick={startListening} disabled={isListening}>
        {isListening ? "Stop listening" : "Start listening"}
      </button>
    </div>
  );
}