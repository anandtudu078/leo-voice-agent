import os
import requests
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Leo Voice Agent API")

# Enable CORS for Next.js frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Google Gemini using the new google-genai SDK
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

GNANI_API_KEY = os.getenv("GNANI_API_KEY")
GNANI_STT_URL = "https://api.vachana.ai/stt/v3"


@app.post("/api/process-voice")
async def process_voice(file: UploadFile = File(...), language_code: str = "en-IN"):
    """Receives audio blob from frontend, transcribes using Gnani Prisma STT, and generates code."""
    try:
        audio_bytes = await file.read()

        # 1. Send audio to Gnani STT API
        headers = {"X-API-Key-ID": GNANI_API_KEY}
        files = {"audio_file": (file.filename, audio_bytes, file.content_type or "audio/wav")}
        data = {"language_code": language_code, "model": "prisma-v3.0"}

        response = requests.post(GNANI_STT_URL, headers=headers, files=files, data=data)

        if response.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Gnani STT Error: {response.text}")

        stt_result = response.json()
        transcript = stt_result.get("transcript", "")

        if not transcript:
            return {"transcript": "", "code": "# No speech detected. Try speaking again."}

        # 2. Generate Code using Gemini LLM based on transcribed voice command
        system_instruction = (
            "You are Leo, an expert autonomous software engineer. "
            "Given a user prompt (which may include Hinglish or English code-switching), "
            "write clean, production-ready code. Return ONLY valid code inside a markdown block "
            "alongside brief explanation comments inside the code."
        )

        llm_response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=f"{system_instruction}\n\nUser Request: {transcript}"
        )
        generated_code = llm_response.text

        return {
            "transcript": transcript,
            "code": generated_code
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)