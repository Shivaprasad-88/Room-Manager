import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const getTaskRotationAdvice = async (members: string[], tasks: string[]) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `We are students living in a room. Members: ${members.join(", ")}. 
      Tasks to do: ${tasks.join(", ")}. 
      Some members might be going home or busy. 
      Suggest a fair rotation for today. Keep it short and friendly.`,
    });
    return response.text;
  } catch (error) {
    console.error("Gemini error:", error);
    return "Could not get AI advice at the moment.";
  }
};

export const getRoomSummary = async (activities: any[]) => {
  const activityText = activities.map(a => `${a.userName}: ${a.message}`).join("\n");
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Summarize the following room activities for today in a funny, student-friendly way:\n${activityText}`,
    });
    return response.text;
  } catch (error) {
    console.error("Gemini error:", error);
    return "Summary unavailable.";
  }
};
