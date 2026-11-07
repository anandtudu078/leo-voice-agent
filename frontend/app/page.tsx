"use client";
import React, { useState, useRef } from "react";
import { Mic, MicOff, Terminal, Code2, Sparkles } from "lucide-react";

export default function LeoDashboard() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [codeOutput, setCodeOutput] = useState("// Welcome back, Anand. Click the mic and speak your command...");
  const [loading, setLoading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    audioChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });
        await sendAudioToBackend(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Microphone access denied:", err);
      alert("Please allow microphone access to use Leo.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const sendAudioToBackend = async (blob: Blob) => {
    setLoading(true);
    setCodeOutput("// Leo is listening, transcribing via Gnani AI, and writing code...");

    const formData = new FormData();
    formData.append("file", blob, "voice_command.wav");
    formData.append("language_code", "en-IN");

    try {
      const res = await fetch("http://localhost:8000/api/process-voice", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setTranscript(data.transcript);
      setCodeOutput(data.code);
    } catch (error) {
      console.error("Error processing voice:", error);
      setCodeOutput("// Error connecting to FastAPI backend. Make sure Python is running.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col p-6">
      {/* Header */}
      <header className="flex justify-between items-center border-b border-slate-800 pb-4 mb-6">
        <div className="flex items-center space-x-3">
          <div className="bg-indigo-600 p-2 rounded-xl">
            <Terminal className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">LEO // Voice AI Engineer</h1>
            <p className="text-xs text-slate-400">Powered by Gnani AI Speech & Gemini</p>
          </div>
        </div>
        <div className="flex items-center space-x-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full text-xs text-emerald-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>System Online</span>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
        {/* Left Control Panel */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" /> Voice Activation
            </h2>
            <p className="text-sm text-slate-400 mb-6">
              Click the microphone and speak naturally in English or Hinglish (e.g., &quot;Write a Python function for binary search&quot;).
            </p>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 mb-4">
              <span className="text-xs text-slate-500 block mb-1">Live Transcript:</span>
              <p className="text-sm italic text-indigo-200 min-h-[40px]">
                {transcript || "Awaiting voice command..."}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center py-6">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`relative group p-6 rounded-full transition-all duration-300 shadow-lg ${
                isRecording
                  ? "bg-rose-600 hover:bg-rose-500 animate-bounce"
                  : "bg-indigo-600 hover:bg-indigo-500"
              }`}
            >
              {isRecording ? <MicOff className="w-8 h-8 text-white" /> : <Mic className="w-8 h-8 text-white" />}
            </button>
            <span className="text-xs text-slate-400 mt-3 font-medium">
              {isRecording ? "Listening... Click to Stop" : "Click to Speak to Leo"}
            </span>
          </div>
        </div>

        {/* Right Code Display Panel */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Code2 className="w-4 h-4 text-indigo-400" /> Generated Code Output
            </h2>
            <span className="text-xs bg-slate-800 px-2 py-1 rounded text-slate-400 font-mono">Python / FastAPI</span>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex-1 font-mono text-sm overflow-auto text-emerald-300">
            {loading ? (
              <div className="flex items-center justify-center h-full text-indigo-400 animate-pulse">
                Synthesizing audio & generating architecture...
              </div>
            ) : (
              <pre className="whitespace-pre-wrap">{codeOutput}</pre>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}