export const responAI = async (chatMessage, sessID) => {
  try {
    const encodedPrompt = encodeURIComponent(chatMessage);
    const url = `https://api.gimita.id/api/ai/gpt4?prompt=${encodedPrompt}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    const jawabanAI = data.data?.answer || data.result || data.message || data.response || JSON.stringify(data);
    
    return jawabanAI;
  } catch (error) {
    console.error('Error from AI:', error);
    throw new Error('Gagal mendapatkan respons dari AI');
  }
};
